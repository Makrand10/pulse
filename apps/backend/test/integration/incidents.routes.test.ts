import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { applyIncidentEngine } from '../../src/modules/incidents/engine';
import { Incident } from '../../src/db/models/Incident';
import { DEFAULT_FAILURE_THRESHOLD, DEFAULT_SUCCESS_THRESHOLD } from '../../src/modules/incidents/stateMachine';
import { signToken } from '../../src/modules/auth/token';
import type { CheckStatus } from '@pulse/shared-types';

let mongo: MongoMemoryServer;
const PUBLIC_URL = 'https://api.example.com/status';

// Strictly increasing virtual clock so batched results stay chronological
// across recordStatuses() calls (real checks advance monotonic time).
let clockMs = Date.now();
let nextClock = () => (clockMs += 1000);

async function signupAndToken(email: string, teamName: string): Promise<string> {
  const app = createApp();
  const res = await request(app).post('/api/v1/auth/signup').send({
    name: 'Owner',
    email,
    password: 'password123',
    teamName,
  });
  return res.body.token as string;
}

async function signupUser(teamId: string, email: string): Promise<string> {
  const app = createApp();
  const signup = await request(app).post('/api/v1/auth/signup').send({
    name: 'Member',
    email,
    password: 'password123',
    teamName: 'AnotherTeam',
  });
  const { userId } = signup.body.user;
  return signToken({ sub: userId, email, teamId, role: 'member' });
}

async function createApi(teamId: string): Promise<string> {
  const api = await Api.create({ teamId, name: 'Engine API', url: PUBLIC_URL });
  return String(api._id);
}

async function recordStatuses(teamId: string, apiId: string, statuses: CheckStatus[]): Promise<void> {
  await CheckResult.insertMany(
    statuses.map((status) => ({
      teamId,
      apiId,
      status,
      latencyMs: status === 'DOWN' ? 0 : 50,
      checkedAt: new Date(nextClock()),
    })),
  );
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

describe('incident engine (state machine wired to Mongo)', () => {
  it('opens an incident after N consecutive failures', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['UP', 'DOWN', 'DOWN', 'DOWN']);

    await applyIncidentEngine({ apiId, teamId });

    const incidents = await Incident.find({ apiId, teamId });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('OPEN');
    expect(incidents[0].timeline[0].type).toBe('OPENED');
  });

  it('does not open on a single blip', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['UP', 'DOWN', 'UP']);

    await applyIncidentEngine({ apiId, teamId });

    expect(await Incident.countDocuments({ apiId, teamId })).toBe(0);
  });

  it('stays open on partial recovery → fail again (no duplicate)', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    await applyIncidentEngine({ apiId, teamId });
    expect(await Incident.countDocuments({ apiId, teamId })).toBe(1);

    // Partial recovery then a failure again — engine must not reopen/duplicate.
    await recordStatuses(teamId, apiId, ['UP', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    await applyIncidentEngine({ apiId, teamId }); // idempotent under retry semantics

    const incidents = await Incident.find({ apiId, teamId });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('OPEN');
  });

  it('auto-resolves after M consecutive successes, appending to timeline', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    await applyIncidentEngine({ apiId, teamId });
    expect((await Incident.findOne({ apiId, teamId }))!.status).toBe('OPEN');

    await recordStatuses(teamId, apiId, ['UP', 'UP']);
    await applyIncidentEngine({ apiId, teamId });

    const incident = await Incident.findOne({ apiId, teamId });
    expect(incident!.status).toBe('RESOLVED');
    expect(incident!.resolvedAt).toBeInstanceOf(Date);
    expect(incident!.timeline.map((t) => t.type)).toEqual(['OPENED', 'RESOLVED']);
  });

  it('ignores an already resolved incident on further successes', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    await recordStatuses(teamId, apiId, ['UP', 'UP']);
    await applyIncidentEngine({ apiId, teamId });

    await recordStatuses(teamId, apiId, ['UP']);
    await applyIncidentEngine({ apiId, teamId });

    const incident = await Incident.findOne({ apiId, teamId });
    expect(incident!.timeline.filter((t) => t.type === 'RESOLVED')).toHaveLength(1);
    expect(await Incident.countDocuments({ apiId, teamId })).toBe(1);
  });
});

describe('incidents REST API', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/incidents');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('lists incidents and filters by status', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-i@example.com', 'IncidentList');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-i@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });

    const list = await request(app).get('/api/v1/incidents').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('OPEN');
    expect(list.body[0].timeline[0].message).toContain(String(DEFAULT_FAILURE_THRESHOLD));

    const open = await request(app)
      .get('/api/v1/incidents?status=OPEN')
      .set('Authorization', `Bearer ${token}`);
    expect(open.body).toHaveLength(1);

    const openOnly = await request(app)
      .get('/api/v1/incidents?status=RESOLVED')
      .set('Authorization', `Bearer ${token}`);
    expect(openOnly.body).toHaveLength(0);
  });

  it('gets a single incident', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-g@example.com', 'IncidentGet');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-g@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });

    const incident = await Incident.findOne({ apiId, teamId });
    const res = await request(app)
      .get(`/api/v1/incidents/${String(incident!._id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(String(incident!._id));
    expect(res.body.teamId).toBe(teamId);
  });

  it('404 for unknown incident id', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-nf@example.com', 'NotFound');
    const res = await request(app)
      .get('/api/v1/incidents/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('adds a comment as a member (append-only timeline)', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-c@example.com', 'CommentTeam');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-c@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const memberToken = await signupUser(teamId, 'm4-cm@example.com');
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    const incident = await Incident.findOne({ apiId, teamId });

    const res = await request(app)
      .post(`/api/v1/incidents/${String(incident!._id)}/comments`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ message: 'Looking into it — possible DNS issue.' });
    expect(res.status).toBe(200);
    expect(res.body.timeline.map((t: { type: string }) => t.type)).toEqual(['OPENED', 'COMMENT']);

    // Timeline is append-only: persisted doc grew, nothing overwritten.
    const stored = await Incident.findOne({ apiId, teamId });
    expect(stored!.timeline).toHaveLength(2);
  });

  it('rejects a comment with an empty message', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-be@example.com', 'BadEmpty');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-be@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    const incident = await Incident.findOne({ apiId, teamId });

    const res = await request(app)
      .post(`/api/v1/incidents/${String(incident!._id)}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('member cannot change incident status (admin only)', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-admin@example.com', 'AdminOnly');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-admin@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const memberToken = await signupUser(teamId, 'm4-mem@example.com');
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    const incident = await Incident.findOne({ apiId, teamId });

    const res = await request(app)
      .patch(`/api/v1/incidents/${String(incident!._id)}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ status: 'INVESTIGATING' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin transitions status, recomputes resolvedAt, and appends timeline', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-tr@example.com', 'Transition');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-tr@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    const incident = await Incident.findOne({ apiId, teamId });
    const id = String(incident!._id);

    const inv = await request(app)
      .patch(`/api/v1/incidents/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INVESTIGATING' });
    expect(inv.status).toBe(200);
    expect(inv.body.status).toBe('INVESTIGATING');

    const resolved = await request(app)
      .patch(`/api/v1/incidents/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RESOLVED' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedAt).toBeTruthy();
    expect(resolved.body.timeline.map((t: { type: string }) => t.type)).toEqual([
      'OPENED',
      'INVESTIGATING',
      'RESOLVED',
    ]);
  });

  it('rejects invalid status transition payloads', async () => {
    const app = createApp();
    const token = await signupAndToken('m4-iv@example.com', 'Invalid');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-iv@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId });
    const incident = await Incident.findOne({ apiId, teamId });

    const res = await request(app)
      .patch(`/api/v1/incidents/${String(incident!._id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'OPEN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 for incidents belonging to another team', async () => {
    const app = createApp();
    const tokenA = await signupAndToken('m4-ta@example.com', 'TenantA');
    const loginA = await request(app).post('/api/v1/auth/login').send({
      email: 'm4-ta@example.com',
      password: 'password123',
    });
    const teamIdA = loginA.body.user.teamId as string;
    const apiId = await createApi(teamIdA);
    await recordStatuses(teamIdA, apiId, ['DOWN', 'DOWN', 'DOWN']);
    await applyIncidentEngine({ apiId, teamId: teamIdA });
    const incident = await Incident.findOne({ apiId, teamId: teamIdA });

    const tokenB = await signupAndToken('m4-tb@example.com', 'TenantB');

    const read = await request(app)
      .get(`/api/v1/incidents/${String(incident!._id)}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(read.status).toBe(404);

    const comment = await request(app)
      .post(`/api/v1/incidents/${String(incident!._id)}/comments`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ message: 'hijack' });
    expect(comment.status).toBe(404);

    const patch = await request(app)
      .patch(`/api/v1/incidents/${String(incident!._id)}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'RESOLVED' });
    expect(patch.status).toBe(404);
  });
});

describe('incident state machine defaults', () => {
  it('uses N=3, M=2 as documented defaults', () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(3);
    expect(DEFAULT_SUCCESS_THRESHOLD).toBe(2);
  });
});