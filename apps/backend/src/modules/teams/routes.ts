import { Router } from 'express';
import { z } from 'zod';
import {
  createTeam,
  findUserById,
  listDirectory,
  listInvitationsForUser,
  listTeamMembers,
  listTeamsForUser,
  inviteUserToTeam,
  acceptInvitation,
  isTeamAdmin,
} from './repository';
import { authGuard, adminOnly, requireTeam, resolveTeam } from '../../middleware/auth';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { signToken } from '../auth/token';

const router = Router();

router.use(authGuard, resolveTeam());

const inviteSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['manager', 'user']).default('user'),
});

const createTeamSchema = z.object({ name: z.string().min(1).max(100) });

// Teams the caller can act on (admin: all they own; manager/user: their own).
router.get('/', async (req, res) => {
  const teams = await listTeamsForUser(req.userId!, req.role!);
  res.json(
    teams.map((t) => ({
      id: String(t._id),
      name: t.name,
      slug: t.slug ?? null,
      role: req.role === 'admin' ? 'admin' : (req.role ?? 'user'),
    })),
  );
});

// Admins can spin up additional "small teams".
router.post('/', adminOnly, async (req, res) => {
  const { name } = createTeamSchema.parse(req.body);
  const team = await createTeam(name, req.userId!);
  const user = await findUserById(req.userId!);
  if (user && !user.teamId) {
    await user.updateOne({ teamId: team._id });
  }
  res.status(201).json({ id: String(team._id), name: team.name, slug: team.slug ?? null });
});

// Roster for the alert-rules editor: active members of the selected team.
router.get('/members', requireTeam(), async (req, res) => {
  const members = await listTeamMembers(req.teamId!);
  res.json(members);
});

// Registered user/manager accounts an admin can invite.
router.get('/directory', adminOnly, async (_req, res) => {
  res.json(await listDirectory());
});

// Pending invitations addressed to the caller.
router.get('/me/invitations', async (req, res) => {
  res.json(await listInvitationsForUser(req.userId!));
});

// Admin invites a registered user into a team they own/administer.
router.post('/:teamId/invitations', adminOnly, async (req, res) => {
  const teamId = String(req.params.teamId);
  const body = inviteSchema.parse(req.body);
  if (!(await isTeamAdmin(req.userId!, teamId))) {
    throw new ForbiddenError('You do not administer this team');
  }
  await inviteUserToTeam(teamId, body.userId, body.role);
  res.status(201).json({ teamId, userId: body.userId, role: body.role, status: 'invited' });
});

// Invitee accepts, which attaches them to the team and refreshes their token
// (their role/team changed, so the old token would be stale).
router.post('/:teamId/invitations/accept', async (req, res) => {
  const teamId = String(req.params.teamId);
  const user = await findUserById(req.userId!);
  if (!user) throw new NotFoundError('User not found');

  const { team, role } = await acceptInvitation(teamId, req.userId!);
  const token = signToken({
    sub: req.userId!,
    email: user.email,
    teamId,
    role: role as 'admin' | 'manager' | 'user' | 'member',
  });

  res.json({
    token,
    user: { id: req.userId, name: user.name, email: user.email, role, teamId },
    team: { id: String(team._id), name: team.name, slug: team.slug ?? null },
  });
});

export default router;
