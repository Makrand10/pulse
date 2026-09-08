import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { getTeam, saveTeam } from './repository';
import { authGuard, adminOnly } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import type { Role } from '@pulse/shared-types';

const router = Router();

router.use(authGuard);

// TODO(M2+): role/sub-team filtering.

router.post('/:teamId/invite', adminOnly, async (req, res) => {
  const { teamId } = req.params;

  if (String(req.teamId) !== teamId) {
    throw new NotFoundError('Team not found');
  }

  const role: Role = req.body?.role === 'admin' ? 'admin' : 'member';
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const token = randomBytes(24).toString('hex');

  const team = await getTeam(teamId);
  team.inviteTokens.push({ token, role, used: false, expiresAt });
  await saveTeam(team);

  res.status(201).json({ inviteToken: token, role, expiresAt: expiresAt.toISOString() });
});

export default router;