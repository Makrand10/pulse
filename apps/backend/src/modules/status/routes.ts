import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Team } from '../../db/models/Team';
import { Api } from '../../db/models/Api';
import { getCurrentStatus, getUptimeStats } from '../healthchecks/repository';
import { toPublicDTO } from './publicDto';
import { latestCheckFrom } from './latestCheck';
import { checkStatusRateLimit } from './rateLimit';
import { NotFoundError, RateLimitError } from '../../lib/errors';

// Unauthenticated status surface for the public status page. No authGuard, no
// team scoping header — everything is resolved from the slug pair, and anything
// that cannot be resolved (or is not marked public) is 404 so probing never
// leaks a document (M8 DoD).

const router = Router();

const slugSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);

function reqIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

router.get('/status/:teamSlug/:apiSlug', async (req: Request, res: Response) => {
  const teamSlug = slugSchema.safeParse(req.params.teamSlug);
  const apiSlug = slugSchema.safeParse(req.params.apiSlug);
  if (!teamSlug.success || !apiSlug.success) {
    throw new NotFoundError('API not found');
  }

  if (!(await checkStatusRateLimit(reqIp(req)))) {
    throw new RateLimitError();
  }

  const team = await Team.findOne({ slug: teamSlug.data }).select('_id').lean();
  if (!team) {
    throw new NotFoundError('API not found');
  }
  const api = await Api.findOne({ teamId: team._id, slug: apiSlug.data, isPublic: true }).lean();
  if (!api) {
    throw new NotFoundError('API not found');
  }

  const apiId = String(api._id);
  const [currentStatus, uptime] = await Promise.all([
    getCurrentStatus(String(team._id), apiId),
    getUptimeStats(String(team._id), apiId),
  ]);

  res.json(
    toPublicDTO({
      name: api.name,
      slug: api.slug ?? apiSlug.data,
      url: api.url,
      method: api.method,
      expectedStatus: api.expectedStatus,
      currentStatus: currentStatus ? latestCheckFrom(currentStatus) : null,
      uptime,
    }),
  );
});

export default router;