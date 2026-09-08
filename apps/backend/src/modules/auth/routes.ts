import { Router } from 'express';
import { z } from 'zod';
import { createUser, findUserByEmail, createTeam, attachUserToTeam } from '../teams/repository';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './token';
import { AuthError, ConflictError } from '../../lib/errors';

const router = Router();

const signupSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  teamName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/signup', async (req, res) => {
  const body = signupSchema.parse(req.body);

  const existing = await findUserByEmail(body.email);
  if (existing) {
    throw new ConflictError('An account already exists for this email');
  }

  const passwordHash = await hashPassword(body.password);
  const user = await createUser({
    name: body.name,
    email: body.email,
    passwordHash,
  });

  const team = await createTeam(body.teamName, String(user._id));
  await attachUserToTeam(String(user._id), String(team._id), 'admin');

  const token = signToken({
    sub: String(user._id),
    email: user.email,
    teamId: String(team._id),
    role: 'admin',
  });

  res.status(201).json({
    token,
    user: { id: String(user._id), name: user.name, email: user.email, role: 'admin' },
    team: { id: String(team._id), name: team.name },
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

  const role = user.role ?? 'member';
  const token = signToken({
    sub: String(user._id),
    email: user.email,
    teamId: user.teamId ? String(user.teamId) : null,
    role,
  });

  res.json({
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role,
      teamId: user.teamId ? String(user.teamId) : null,
    },
  });
});

export default router;