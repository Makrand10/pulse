import { Router, type Request, type Response } from 'express';
import {
  createApi,
  listApis,
  listApisForTeams,
  getApi,
  updateApi,
  deleteApi,
} from './repository';
import { toApiDto } from './serializers';
import { apiCreateSchema, apiUpdateSchema } from '@pulse/shared-types';
import { assertUrlProbeable } from '../../lib/ssrf';
import { authGuard, requireTeam, resolveTeam, adminOnly } from '../../middleware/auth';
import { ValidationErrorShape } from '../../lib/errors';
import { listTeamMembers, getTeamSlug, getTeamNames, listTeamsForUser } from '../teams/repository';
import { startHealthCheckWorkflow, stopHealthCheckWorkflow } from '../../temporal/lifecycle';
import { logger } from '../../lib/logger';
import { listCheckResults, getUptimeStats, getCurrentStatus } from '../healthchecks/repository';

const router = Router();

router.use(authGuard, resolveTeam());

// Alert rules configure a subset of team members per API; ids that are not in
// the roster would silently notify nobody, so they are rejected up front.
async function assertTeamMemberIds(teamId: string, ids: string[] | undefined): Promise<void> {
  if (!ids || ids.length === 0) return;
  const members = await listTeamMembers(teamId);
  const memberIds = new Set(members.map((m) => m.userId));
  for (const id of ids) {
    if (!memberIds.has(id)) {
      throw new ValidationErrorShape(`alertUserIds must be team members (unknown: ${id})`);
    }
  }
}

// Only admins register/change APIs of the team they administer.
router.post('/', adminOnly, requireTeam(), async (req: Request, res: Response) => {
  const input = apiCreateSchema.parse(req.body);
  assertUrlProbeable(input.url);
  await assertTeamMemberIds(req.teamId!, input.alertUserIds);
  const api = await createApi(req.teamId!, input);
  scheduleChecks(api._id.toString(), req.teamId!, api.intervalSeconds);
  res.status(201).json(toApiDto(api));
});

// Admins see every team they own (optionally narrowed with x-team-id);
// managers/users see only their own team.
router.get('/', async (req: Request, res: Response) => {
  let teamIds: string[];
  if (req.role === 'admin') {
    teamIds = req.teamId
      ? [req.teamId]
      : (await listTeamsForUser(req.userId!, 'admin')).map((t) => String(t._id));
  } else {
    if (!req.teamId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This user is not part of a team yet' } });
      return;
    }
    teamIds = [req.teamId];
  }

  const apis = teamIds.length === 1 ? await listApis(teamIds[0]!) : await listApisForTeams(teamIds);
  const names = await getTeamNames(teamIds);
  const dtos = await Promise.all(
    apis.map(async (api) => ({
      ...toApiDto(api),
      teamName: names[String(api.teamId)] ?? null,
      currentStatus: await getCurrentStatus(String(api.teamId), String(api._id)),
    })),
  );
  res.json(dtos);
});

router.get('/:apiId', requireTeam(), async (req: Request, res: Response) => {
  const apiId = String(req.params.apiId);
  const api = await getApi(req.teamId!, apiId);
  const [uptime, currentStatus, teamSlug, names] = await Promise.all([
    getUptimeStats(req.teamId!, apiId),
    getCurrentStatus(req.teamId!, apiId),
    getTeamSlug(req.teamId!),
    getTeamNames([req.teamId!]),
  ]);
  res.json({
    ...toApiDto(api),
    teamName: names[req.teamId!] ?? null,
    teamSlug,
    uptime,
    currentStatus,
  });
});

router.patch('/:apiId', adminOnly, requireTeam(), async (req: Request, res: Response) => {
  const input = apiUpdateSchema.parse(req.body);
  if (input.url) {
    assertUrlProbeable(input.url);
  }
  await assertTeamMemberIds(req.teamId!, input.alertUserIds);
  const api = await updateApi(req.teamId!, String(req.params.apiId), input);
  if (input.isActive === false) {
    cancelChecks(api._id.toString());
  } else if (input.isActive === true) {
    scheduleChecks(api._id.toString(), req.teamId!, api.intervalSeconds);
  }
  res.json(toApiDto(api));
});

router.delete('/:apiId', adminOnly, requireTeam(), async (req: Request, res: Response) => {
  const apiId = String(req.params.apiId);
  await deleteApi(req.teamId!, apiId);
  cancelChecks(apiId);
  res.status(204).send();
});

router.get('/:apiId/checks', requireTeam(), async (req: Request, res: Response) => {
  const apiId = String(req.params.apiId);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const checks = await listCheckResults(req.teamId!, apiId, limit);
  res.json(checks);
});

function scheduleChecks(apiId: string, teamId: string, intervalSeconds: number): void {
  startHealthCheckWorkflow(apiId, teamId, intervalSeconds).catch((err) => {
    logger.warn({ err }, `temporal unavailable; health checks for ${apiId} not started`);
  });
}

function cancelChecks(apiId: string): void {
  stopHealthCheckWorkflow(apiId).catch((err) => {
    logger.warn({ err }, `temporal unavailable; health checks for ${apiId} not stopped`);
  });
}

export default router;
