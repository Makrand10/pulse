import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Team } from '../../src/db/models/Team';
import { User } from '../../src/db/models/User';
import { config } from '../../src/config';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 60000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

async function signup(app: ReturnType<typeof createApp>, name: string, email: string, teamName: string) {
  const res = await request(app).post('/api/v1/auth/signup').send({
    name,
    email,
    password: 'password123',
    teamName,
  });
  return res.body as { token: string; user: { id: string; role: string } };
}

describe('team invite route (admin only)', () => {
  it('returns 201 with a token when an admin invites', async () => {
    const app = createApp();
    const { token, user } = await signup(app, 'Admin', 'admin@example.com', 'Alpha');

    const team = await Team.findOne({ name: 'Alpha' });
    const teamId = String(team!._id);

    const res = await request(app)
      .post(`/api/v1/teams/${teamId}/invite`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.inviteToken).toBeTruthy();
    expect(res.body.role).toBe('member');
    expect(user.role).toBe('admin');
  });

  it('returns 403 when a member tries to invite (AC: no silent no-op)', async () => {
    const app = createApp();
    const { token } = await signup(app, 'Admin2', 'admin2@example.com', 'Beta');
    void token;

    const memberUser = await User.create({
      name: 'Member',
      email: 'member@example.com',
      passwordHash: 'x',
    });

    const team = await Team.findOne({ name: 'Beta' });
    team!.members.push({ userId: memberUser._id, role: 'member' });
    await team!.save();

    const memberToken = createMemberToken(memberUser._id.toString(), String(team!._id));

    const res = await request(app)
      .post(`/api/v1/teams/${team!._id}/invite`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ role: 'member' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 when a user tries to invite to a team they do not belong to', async () => {
    const app = createApp();
    await signup(app, 'Admin3', 'admin3@example.com', 'Gamma');
    const otherTeam = await Team.create({ name: 'Unrelated' });

    const { token } = await signup(app, 'Admin4', 'admin4@example.com', 'Delta');

    const res = await request(app)
      .post(`/api/v1/teams/${otherTeam._id}/invite`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication (401 without a token)', async () => {
    const app = createApp();
    const res = await request(app).post(`/api/v1/teams/whatever/invite`).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

function createMemberToken(userId: string, teamId: string) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { sub: userId, email: 'member@example.com', teamId, role: 'member' },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}