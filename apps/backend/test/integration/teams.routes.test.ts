import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Team } from '../../src/db/models/Team';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 60000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

async function signupAdmin(app: ReturnType<typeof createApp>, name: string, email: string, teamName: string) {
  const res = await request(app).post('/api/v1/auth/signup').send({
    name,
    email,
    password: 'password123',
    teamName,
  });
  return res.body as { token: string; user: { id: string; role: string; teamId: string }; team: { id: string } };
}

async function signupMember(app: ReturnType<typeof createApp>, name: string, email: string, role: 'user' | 'manager') {
  const res = await request(app).post('/api/v1/auth/signup/user').send({
    name,
    email,
    password: 'password123',
    role,
  });
  return res.body as { token: string; user: { id: string; role: string; teamId: string | null } };
}

describe('teams + invitations', () => {
  it('admin signup creates a team they own; GET /teams lists it', async () => {
    const app = createApp();
    const { token, team } = await signupAdmin(app, 'Admin', 't1-admin@example.com', 'Alpha');

    const teamDoc = await Team.findById(team.id);
    expect(teamDoc!.ownerId).toBeTruthy();

    const res = await request(app).get('/api/v1/teams').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: team.id, name: 'Alpha', role: 'admin' });
  });

  it('admin invites a registered user; the user accepts and joins the team', async () => {
    const app = createApp();
    const { token, team } = await signupAdmin(app, 'Admin2', 't2-admin@example.com', 'Beta');
    const member = await signupMember(app, 'Manager', 't2-manager@example.com', 'manager');

    // The pool of registered users is visible to admins.
    const directory = await request(app)
      .get('/api/v1/teams/directory')
      .set('Authorization', `Bearer ${token}`);
    expect(directory.status).toBe(200);
    expect(directory.body.some((u: { email: string }) => u.email === 't2-manager@example.com')).toBe(true);

    const invite = await request(app)
      .post(`/api/v1/teams/${team.id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: member.user.id, role: 'manager' });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('invited');

    const invitations = await request(app)
      .get('/api/v1/teams/me/invitations')
      .set('Authorization', `Bearer ${member.token}`);
    expect(invitations.status).toBe(200);
    expect(invitations.body).toEqual([
      expect.objectContaining({ teamId: team.id, teamName: 'Beta', role: 'manager' }),
    ]);

    const accept = await request(app)
      .post(`/api/v1/teams/${team.id}/invitations/accept`)
      .set('Authorization', `Bearer ${member.token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.user).toMatchObject({ role: 'manager', teamId: team.id });

    // Now an active member with a fresh token.
    const members = await request(app)
      .get('/api/v1/teams/members')
      .set('Authorization', `Bearer ${accept.body.token}`)
      .set('x-team-id', team.id);
    expect(members.status).toBe(200);
    expect(members.body.map((m: { email: string }) => m.email)).toContain('t2-manager@example.com');
  });

  it('rejects invites from non-admins with 403', async () => {
    const app = createApp();
    const { team } = await signupAdmin(app, 'Admin3', 't3-admin@example.com', 'Gamma');
    const member = await signupMember(app, 'User', 't3-user@example.com', 'user');

    const res = await request(app)
      .post(`/api/v1/teams/${team.id}/invitations`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ userId: member.user.id, role: 'user' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects invites to a team the admin does not administer', async () => {
    const app = createApp();
    await signupAdmin(app, 'Admin4', 't4-admin@example.com', 'Delta');
    const otherTeam = await Team.create({ name: 'Unrelated' });
    const { token } = await signupAdmin(app, 'Admin5', 't5-admin@example.com', 'Epsilon');
    const member = await signupMember(app, 'User5', 't5-user@example.com', 'user');

    const res = await request(app)
      .post(`/api/v1/teams/${otherTeam._id}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: member.user.id, role: 'user' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires authentication (401 without a token)', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/teams');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
