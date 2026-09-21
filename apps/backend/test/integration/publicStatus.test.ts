import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Team } from '../../src/db/models/Team';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { makeRedisStatusLimiter, setStatusRateLimiterForTests } from '../../src/modules/status/rateLimit';

let mongo: MongoMemoryServer;

async function signupTeam(email: string, teamName: string): Promise<{ teamId: string; teamSlug: string }> {
  const app = createApp();
  const res = await request(app).post('/api/v1/auth/signup').send({
    name: 'Owner',
    email,
    password: 'password123',
    teamName,
  });
  const team = await Team.findById(res.body.team.id);
  return { teamId: String(team!._id), teamSlug: team!.slug! };
}

async function createApi(
  teamId: string,
  overrides: Partial<{ name: string; slug: string; isPublic: boolean }> = {},
): Promise<string> {
  const api = await Api.create({
    teamId,
    name: overrides.name ?? 'Public API',
    slug: overrides.slug ?? 'public-api',
    url: 'https://api.example.com/status',
    isPublic: overrides.isPublic ?? true,
  });
  return String(api._id);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

afterEach(() => {
  setStatusRateLimiterForTests(makeRedisStatusLimiter());
});

describe('M8 DoD: public status endpoint', () => {
  it('serves a public API without auth and only allowlisted fields', async () => {
    const app = createApp();
    const { teamId, teamSlug } = await signupTeam('m8-public@example.com', 'Public Team');
    const apiId = await createApi(teamId, { slug: 'health' });
    await CheckResult.create({
      teamId,
      apiId,
      status: 'UP',
      latencyMs: 42,
      statusCode: 200,
      checkedAt: new Date(),
    });

    const res = await request(app).get(`/public/status/${teamSlug}/health`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['expectedStatus', 'method', 'name', 'slug', 'status', 'uptime', 'url'].sort(),
    );
    expect(res.body.slug).toBe('health');
    expect(res.body.status.status).toBe('UP');
    // No tenant/secret material may ever appear in the public payload.
    expect(res.body.teamId).toBeUndefined();
    expect(res.body.headers).toBeUndefined();
    expect(res.body.body).toBeUndefined();
    expect(res.body.alertUserIds).toBeUndefined();
    expect(res.body.isPublic).toBeUndefined();
  });

  it('returns 404 (not a data leak) for a non-public API', async () => {
    const app = createApp();
    const { teamId, teamSlug } = await signupTeam('m8-private@example.com', 'Private Team');
    await createApi(teamId, { slug: 'secret-api', isPublic: false });

    const res = await request(app).get(`/public/status/${teamSlug}/secret-api`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.name).toBeUndefined();
    expect(res.body.url).toBeUndefined();
  });

  it('returns 404 for unknown slugs and malformed slugs', async () => {
    const app = createApp();
    const { teamSlug } = await signupTeam('m8-unknown@example.com', 'Unknown Team');

    const unknown = await request(app).get(`/public/status/${teamSlug}/does-not-exist`);
    expect(unknown.status).toBe(404);

    const noTeam = await request(app).get('/public/status/no-such-team/whatever');
    expect(noTeam.status).toBe(404);

    const malformed = await request(app).get(`/public/status/${teamSlug}/BAD_SLUG!`);
    expect(malformed.status).toBe(404);
  });

  it('enforces the per-IP rate limit', async () => {
    const app = createApp();
    const { teamId, teamSlug } = await signupTeam('m8-rate@example.com', 'Rate Team');
    await createApi(teamId, { slug: 'rate-limited' });

    setStatusRateLimiterForTests(async () => false);
    const res = await request(app).get(`/public/status/${teamSlug}/rate-limited`);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});