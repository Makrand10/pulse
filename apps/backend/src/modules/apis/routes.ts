import { Router, type Request, type Response } from 'express';
import { createApi, listApis, getApi, updateApi, deleteApi } from './repository';
import { toApiDto } from './serializers';
import { apiCreateSchema, apiUpdateSchema } from '@pulse/shared-types';
import { assertUrlProbeable } from '../../lib/ssrf';
import { authGuard, requireTeam } from '../../middleware/auth';
import { startHealthCheckWorkflow, stopHealthCheckWorkflow } from '../../temporal/lifecycle';
import { logger } from '../../lib/logger';
import { listCheckResults, getUptimeStats, getCurrentStatus } from '../healthchecks/repository';

const router = Router();

router.use(authGuard, requireTeam());

router.post('/', async (req: Request, res: Response) => {
  const input = apiCreateSchema.parse(req.body);
  assertUrlProbeable(input.url);
  const api = await createApi(req.teamId!, input);
  scheduleChecks(api._id.toString(), req.teamId!, api.intervalSeconds);
  res.status(201).json(toApiDto(api));
});

router.get('/', async (req: Request, res: Response) => {
  const apis = await listApis(req.teamId!);
  const dtos = await Promise.all(
    apis.map(async (api) => ({
      ...toApiDto(api),
      currentStatus: await getCurrentStatus(req.teamId!, String(api._id)),
    })),
  );
  res.json(dtos);
});

router.get('/:apiId', async (req: Request, res: Response) => {
  const apiId = String(req.params.apiId);
  const api = await getApi(req.teamId!, apiId);
  const [uptime, currentStatus] = await Promise.all([
    getUptimeStats(req.teamId!, apiId),
    getCurrentStatus(req.teamId!, apiId),
  ]);
  res.json({ ...toApiDto(api), uptime, currentStatus });
});

router.patch('/:apiId', async (req: Request, res: Response) => {
  const input = apiUpdateSchema.parse(req.body);
  if (input.url) {
    assertUrlProbeable(input.url);
  }
  const api = await updateApi(req.teamId!, String(req.params.apiId), input);
  if (input.isActive === false) {
    cancelChecks(api._id.toString());
  } else if (input.isActive === true) {
    scheduleChecks(api._id.toString(), req.teamId!, api.intervalSeconds);
  }
  res.json(toApiDto(api));
});

router.delete('/:apiId', async (req: Request, res: Response) => {
  const apiId = String(req.params.apiId);
  await deleteApi(req.teamId!, apiId);
  cancelChecks(apiId);
  res.status(204).send();
});

router.get('/:apiId/checks', async (req: Request, res: Response) => {
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