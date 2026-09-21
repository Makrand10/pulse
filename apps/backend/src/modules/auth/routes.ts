import { Router } from 'express';
import { z } from 'zod';
import {
  createUser,
  findUserByEmail,
  createTeam,
  listTeamsForUser,
} from '../teams/repository';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './token';
import { AuthError, ConflictError } from '../../lib/errors';

const router = Router();

// Admin portal signup: registering a team also mints its id and the admin
// account that owns it.
const adminSignupSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  teamName: z.string().min(1).max(100),
});

// User/manager portal signup: an account with no team yet. It appears in the
// admin directory and joins a team only after accepting an invitation.
const memberSignupSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(['user', 'manager']).default('user'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/signup', async (req, res) => {
  const body = adminSignupSchema.parse(req.body);

  const existing = await findUserByEmail(body.email);
  if (existing) {
    throw new ConflictError('An account already exists for this email');
  }

  const passwordHash = await hashPassword(body.password);
  const user = await createUser({
    name: body.name,
    email: body.email,
    passwordHash,
    role: 'admin',
  });

  const team = await createTeam(body.teamName, String(user._id));
  await user.updateOne({ teamId: team._id, role: 'admin' });

  const token = signToken({
    sub: String(user._id),
    email: user.email,
    teamId: String(team._id),
    role: 'admin',
  });

  res.status(201).json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: 'admin',
      teamId: String(team._id),
    },
    team: { id: String(team._id), name: team.name, slug: team.slug ?? null },
  });
});

router.post('/signup/user', async (req, res) => {
  const body = memberSignupSchema.parse(req.body);

  const existing = await findUserByEmail(body.email);
  if (existing) {
    throw new ConflictError('An account already exists for this email');
  }

  const passwordHash = await hashPassword(body.password);
  const user = await createUser({
    name: body.name,
    email: body.email,
    passwordHash,
    role: body.role,
  });

  const token = signToken({
    sub: String(user._id),
    email: user.email,
    teamId: null,
    role: body.role,
  });

  res.status(201).json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: body.role,
      teamId: null,
    },
  });
});

router.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);

  const user = await findUserByEmail(body.email);
  if (!user) {
    throw new AuthError('Invalid credentials');
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    throw new AuthError('Invalid credentials');
  }

  const role = (user.role ?? 'user') as 'admin' | 'manager' | 'user' | 'member';
  // An admin administers one or more teams; default the token to the first so
  // there is always a sensible active team until they pick another.
  let teamId = user.teamId ? String(user.teamId) : null;
  if (role === 'admin' && !teamId) {
    const teams = await listTeamsForUser(String(user._id), role);
    teamId = teams[0] ? String(teams[0]._id) : null;
  }
  if (role === 'admin' && teamId) {
    await user.updateOne({ teamId });
  }

  const token = signToken({
    sub: String(user._id),
    email: user.email,
    teamId,
    role,
  });

  res.json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role,
      teamId,
    },
  });
});

export default router;
