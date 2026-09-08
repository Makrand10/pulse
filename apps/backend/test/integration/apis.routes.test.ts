import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { signToken } from '../../src/modules/auth/token';

let mongo: MongoMemoryServer;
const PUBLIC_URL = 'https://api.example.com/status';

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

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

describe('APIs CRUD routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/apis');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('creates and lists an API monitor', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-a@example.com', 'Alpha');
    const createRes = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Checkout API', url: PUBLIC_URL });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Checkout API');
    expect(createRes.body.url).toBe(PUBLIC_URL);
    expect(createRes.body.hasAuthToken).toBe(false);
    expect(createRes.body.authToken).toBeUndefined();

    const listRes = await request(app)
      .get('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(createRes.body.id);
  });

  it('stores the auth token encrypted, never in plaintext', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-b@example.com', 'Bravo');
    const res = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Slack Inbound', url: PUBLIC_URL, authToken: 'xoxb-super-secret' });

    expect(res.status).toBe(201);
    expect(res.body.hasAuthToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('xoxb-super-secret');
  });

  it('applies defaults when omitted', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-c@example.com', 'Charlie');
    const res = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Defaults', url: PUBLIC_URL });

    expect(res.body.method).toBe('GET');
    expect(res.body.expectedStatus).toBe(200);
    expect(res.body.intervalSeconds).toBe(60);
    expect(res.body.isActive).toBe(true);
  });

  it('updates a subset of fields', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-d@example.com', 'Delta');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Auth API', url: PUBLIC_URL, isPublic: false });

    const res = await request(app)
      .patch(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isPublic: true, latencyThresholdMs: 2500 });

    expect(res.status).toBe(200);
    expect(res.body.isPublic).toBe(true);
    expect(res.body.latencyThresholdMs).toBe(2500);
    expect(res.body.name).toBe('Auth API');
  });

  it('replaces the auth token on update without exposing it', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-e@example.com', 'Echo');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Secured', url: PUBLIC_URL, authToken: 'first-secret' });
    const res = await request(app)
      .patch(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ authToken: 'second-secret' });

    expect(res.status).toBe(200);
    expect(res.body.hasAuthToken).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('first-secret');
    expect(JSON.stringify(res.body)).not.toContain('second-secret');
  });

  it('deletes an API monitor', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-f@example.com', 'Foxtrot');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Gone Soon', url: PUBLIC_URL });

    const delRes = await request(app)
      .delete(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    const getRes = await request(app)
      .get(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects SSRF targets on create', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-g@example.com', 'Golf');
    const localRes = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Local', url: 'http://169.254.169.254/latest/meta-data' });
    expect(localRes.status).toBe(400);
    expect(localRes.body.error.code).toBe('VALIDATION_ERROR');

    const ftpRes = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'FTP', url: 'file:///etc/passwd' });
    expect(ftpRes.status).toBe(400);
  });

  it('rejects SSRF targets on URL update', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-h@example.com', 'Hotel');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Was Fine', url: PUBLIC_URL });

    const res = await request(app)
      .patch(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'http://127.0.0.1:27017/' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid payloads with 400', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-i@example.com', 'India');
    const res = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', url: 'not-a-url', intervalSeconds: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('multi-tenant isolation', () => {
  it('returns 404 when Team B reads Team As API', async () => {
    const app = createApp();
    const teamA = await signupAndToken('m2-ta@example.com', 'TenantA');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${teamA}`)
      .send({ name: 'TenantA Secret API', url: PUBLIC_URL });

    const signupB = await request(app).post('/api/v1/auth/signup').send({
      name: 'Owner B',
      email: 'm2-tb@example.com',
      password: 'password123',
      teamName: 'TenantB',
    });
    const teamB = signupB.body.token as string;

    const crossRead = await request(app)
      .get(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${teamB}`);
    expect(crossRead.status).toBe(404);
    expect(crossRead.body.error.code).toBe('NOT_FOUND');
  });

  it('Team B cannot update or delete Team As API', async () => {
    const app = createApp();
    const teamA = await signupAndToken('m2-tc@example.com', 'TenantC');
    const created = await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${teamA}`)
      .send({ name: 'C API', url: PUBLIC_URL });

    const signupB = await request(app).post('/api/v1/auth/signup').send({
      name: 'Owner D',
      email: 'm2-td@example.com',
      password: 'password123',
      teamName: 'TenantD',
    });
    const teamB = signupB.body.token as string;

    const updateRes = await request(app)
      .patch(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${teamB}`)
      .send({ name: 'Hijacked' });
    expect(updateRes.status).toBe(404);

    const delRes = await request(app)
      .delete(`/api/v1/apis/${created.body.id}`)
      .set('Authorization', `Bearer ${teamB}`);
    expect(delRes.status).toBe(404);
  });

  it('Team lists are isolated (no cross-tenant leakage)', async () => {
    const app = createApp();
    const teamA = await signupAndToken('m2-te@example.com', 'TenantE');
    await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${teamA}`)
      .send({ name: 'E Secret', url: PUBLIC_URL });

    const teamB = await signupAndToken('m2-tf@example.com', 'TenantF');
    const listB = await request(app)
      .get('/api/v1/apis')
      .set('Authorization', `Bearer ${teamB}`);
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(0);
  });

  it('members of the same team can read the teams APIs', async () => {
    const app = createApp();
    const token = await signupAndToken('m2-tg@example.com', 'TenantG');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm2-tg@example.com',
      password: 'password123',
    });
    const memberToken = await signupUser(
      login.body.user.teamId,
      'm2-th@example.com',
    );
    await request(app)
      .post('/api/v1/apis')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Shared', url: PUBLIC_URL });

    const res = await request(app)
      .get('/api/v1/apis')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((a: { name: string }) => a.name === 'Shared')).toBe(true);
  });
});