import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { computeHourlyUptimeRollups, getUptimeStats, getCurrentStatus, getLatestCheck } from '../../src/modules/healthchecks/repository';
import type { CheckStatus } from '@pulse/shared-types';

let mongo: MongoMemoryServer;

function hourAlignedMs(): number {
  return Math.floor(Date.now() / 3600_000) * 3600_000;
}

async function record(teamId: string, apiId: string, status: CheckStatus, offsetFromHourStartMs: number, latencyMs = 80): Promise<void> {
  await CheckResult.create({
    teamId,
    apiId,
    status,
    latencyMs,
    checkedAt: new Date(hourAlignedMs() + offsetFromHourStartMs),
  });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

describe('M7 uptime rollup (§6.4)', () => {
  it('aggregates hourly buckets and never reads raw checks for uptime windows', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = String((await Api.create({ teamId, name: 'A', url: 'https://a.example', expectedStatus: 200 }))._id);

    for (let i = 0; i < 90; i++) await record(teamId, apiId, 'UP', i * 1000);
    for (let i = 0; i < 10; i++) await record(teamId, apiId, 'DOWN', 100_000 + i * 1000);

    const buckets = await computeHourlyUptimeRollups();
    expect(buckets).toBeGreaterThanOrEqual(1);

    const stats = await getUptimeStats(teamId, apiId);
    expect(stats.pct24h).toBeCloseTo(90, 0);
    expect(stats.pct7d).toBeCloseTo(90, 0);
    expect(stats.pct30d).toBeCloseTo(90, 0);
  });

  it('returns null uptime when no rollup buckets exist (insufficient data)', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = String((await Api.create({ teamId, name: 'B', url: 'https://b.example', expectedStatus: 200 }))._id);

    const stats = await getUptimeStats(teamId, apiId);
    expect(stats).toEqual({ pct24h: null, pct7d: null, pct30d: null });
  });

  it('folds multiple hourly buckets correctly into a window', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = String((await Api.create({ teamId, name: 'C', url: 'https://c.example', expectedStatus: 200 }))._id);

    // 100% hour (two hours ago) + 50% hour (previous hour).
    await computeHourlyUptimeRollups(); // warm, no-op
    // Write into the previous hour bucket boundary by using a fake window:
    // simplest is to insert rollup buckets directly for window math coverage.
    const { UptimeRollup } = await import('../../src/db/models/UptimeRollup');
    const hour = 3600_000;
    const prev2 = new Date(hourAlignedMs() - 2 * hour);
    const prev1 = new Date(hourAlignedMs() - hour);
    await UptimeRollup.create([
      { teamId, apiId, windowStart: prev2, windowEnd: new Date(prev2.getTime() + hour), totalChecks: 10, downChecks: 0, degradedChecks: 0, uptimePct: 100 },
      { teamId, apiId, windowStart: prev1, windowEnd: new Date(prev1.getTime() + hour), totalChecks: 10, downChecks: 5, degradedChecks: 0, uptimePct: 50 },
    ]);

    const stats = await getUptimeStats(teamId, apiId);
    expect(stats.pct24h).toBeCloseTo(75, 0);
  });

  it('scopes uptime by teamId (multi-tenant)', async () => {
    const teamA = new Types.ObjectId().toString();
    const teamB = new Types.ObjectId().toString();
    const apiId = String((await Api.create({ teamId: teamA, name: 'D', url: 'https://d.example', expectedStatus: 200 }))._id);

    await record(teamA, apiId, 'UP', 5);
    await computeHourlyUptimeRollups();
    const forA = await getUptimeStats(teamA, apiId);
    const forB = await getUptimeStats(teamB, apiId);
    expect(forA.pct24h).not.toBeNull();
    expect(forB.pct24h).toBeNull();
  });
});

describe('current status read path (§6.4)', () => {
  it('returns the latest Mongo check when Redis is cold', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = String((await Api.create({ teamId, name: 'E', url: 'https://e.example', expectedStatus: 200 }))._id);

    const latest = await getLatestCheck(teamId, apiId);
    expect(latest).toBeNull();

    await record(teamId, apiId, 'DOWN', 5);
    const now = await getCurrentStatus(teamId, apiId);
    expect(now).not.toBeNull();
    expect(now!.status).toBe('DOWN');
  });
});