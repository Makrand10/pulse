import { CheckResult } from '../../db/models/CheckResult';
import { Api } from '../../db/models/Api';
import { UptimeRollup } from '../../db/models/UptimeRollup';
import { getRedis } from '../../lib/redis';
import type { CheckStatus } from '@pulse/shared-types';

export interface RecordCheckInput {
  apiId: string;
  teamId: string;
  status: CheckStatus;
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
}

const STATUS_KEY_PREFIX = 'status:';
const STATUS_KEY_TTL_SECONDS = 3600; // self-healing safety net (PRD §6.4)

export async function recordCheckResult(input: RecordCheckInput): Promise<void> {
  const { apiId, teamId, status, latencyMs, statusCode, errorMessage } = input;
  await CheckResult.create({
    apiId,
    teamId,
    status,
    latencyMs,
    statusCode,
    errorMessage,
    checkedAt: new Date(),
  });
  try {
    await getRedis().set(
      `${STATUS_KEY_PREFIX}${apiId}`,
      JSON.stringify({ status, lastCheckedAt: new Date().toISOString(), latencyMs }),
      { EX: STATUS_KEY_TTL_SECONDS },
    );
  } catch (err) {
    // Redis is optional for the write path; Mongo is the source of truth.
    console.warn(`redis status cache update failed: ${(err as Error).message}`);
  }
}

export async function listCheckResults(
  teamId: string,
  apiId: string,
  limit = 50,
): Promise<InferCheckResult[]> {
  return CheckResult.find({ teamId, apiId }, null, { sort: { checkedAt: -1 }, limit });
}

export async function getApiForWorker(apiId: string): Promise<ApiForWorker | null> {
  const api = await Api.findById(apiId).lean();
  if (!api) return null;
  const { _id, teamId, name, url, method, expectedStatus, latencyThresholdMs, intervalSeconds, headers, authTokenEncrypted, body } = api as unknown as Record<string, unknown>;
  return {
    apiId: String(_id),
    teamId: String(teamId),
    name: name as string,
    url: url as string,
    method: (method as string) || 'GET',
    expectedStatus: (expectedStatus as number) ?? 200,
    latencyThresholdMs: (latencyThresholdMs as number) ?? 1000,
    intervalSeconds: (intervalSeconds as number) ?? 60,
    headers: (headers ?? {}) as Record<string, string>,
    authTokenEncrypted: (authTokenEncrypted as string) ?? undefined,
    body: (body as string) ?? undefined,
  };
}

export type ApiForWorker = {
  apiId: string;
  teamId: string;
  name: string;
  url: string;
  method: string;
  expectedStatus: number;
  latencyThresholdMs: number;
  intervalSeconds: number;
  headers: Record<string, string>;
  authTokenEncrypted?: string;
  body?: string;
};

export type InferCheckResult = {
  status: CheckStatus;
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  checkedAt: Date;
};

const HOUR_MS = 60 * 60 * 1000;

function truncateHourUtc(ts: number): number {
  return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

// Hourly bucket boundary that covers a rolling window: the oldest hour-aligned
// bucket whose window overlaps (now - windowMs). Buckets are UTC hour-aligned.
function windowStartFor(nowMs: number, windowMs: number): number {
  return truncateHourUtc(nowMs - windowMs);
}

// System-wide cron aggregation (§6.4): for every active API, fold the last
// completed hour of raw CheckResult rows into an hourly UptimeRollup bucket.
// This is an internal job that legitimately crosses teams (like the health
// worker); user-facing reads below stay teamId-scoped.
export async function computeHourlyUptimeRollups(): Promise<number> {
  const now = Date.now();
  const bucketStart = truncateHourUtc(now); // "current hour" as the write window
  const bucketEnd = bucketStart + HOUR_MS;
  const apis = await Api.find({ isActive: true }, { teamId: 1, _id: 1 }).lean();
  let buckets = 0;

  for (const api of apis) {
    const rows = await CheckResult.aggregate<{
      total: number;
      down: number;
      degraded: number;
    }>([
      {
        $match: {
          apiId: api._id,
          checkedAt: { $gte: new Date(bucketStart), $lt: new Date(bucketEnd) },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          down: { $sum: { $cond: [{ $eq: ['$status', 'DOWN'] }, 1, 0] } },
          degraded: { $sum: { $cond: [{ $eq: ['$status', 'DEGRADED'] }, 1, 0] } },
        },
      },
    ]);
    const row = rows[0];
    if (!row || row.total === 0) continue; // empty hour → no bucket (insufficient data)

    const uptimePct = Number((((row.total - row.down) / row.total) * 100).toFixed(2));
    await UptimeRollup.updateOne(
      { apiId: api._id, windowStart: new Date(bucketStart) },
      {
        $set: {
          teamId: api.teamId,
          apiId: api._id,
          windowStart: new Date(bucketStart),
          windowEnd: new Date(bucketEnd),
          totalChecks: row.total,
          downChecks: row.down,
          degradedChecks: row.degraded,
          uptimePct,
        },
      },
      { upsert: true },
    );
    buckets += 1;
  }
  return buckets;
}

export interface UptimeStats {
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
}

// Always > 0 coverage windows read only from pre-aggregated rollup buckets —
// never a raw CheckResult scan (PRD §6.4 / FR-7 AC). A missing bucket makes the
// window null ("insufficient data"), not a fabricated 100%.
export async function getUptimeStats(teamId: string, apiId: string): Promise<UptimeStats> {
  const now = Date.now();
  const since = windowStartFor(now, 30 * 24 * HOUR_MS);
  const docs = await UptimeRollup.find(
    { teamId, apiId, windowStart: { $gte: new Date(since) } },
    { windowStart: 1, totalChecks: 1, downChecks: 1 },
  )
    .sort({ windowStart: 1 })
    .lean();

  const pctSince = (windowMs: number): number | null => {
    const cutoff = windowStartFor(now, windowMs);
    let total = 0;
    let down = 0;
    for (const doc of docs) {
      if (doc.windowStart.getTime() >= cutoff) {
        total += doc.totalChecks;
        down += doc.downChecks;
      }
    }
    if (total === 0) return null;
    return Number((((total - down) / total) * 100).toFixed(2));
  };

  return {
    pct24h: pctSince(24 * HOUR_MS),
    pct7d: pctSince(7 * 24 * HOUR_MS),
    pct30d: pctSince(30 * 24 * HOUR_MS),
  };
}

export async function getLatestCheck(teamId: string, apiId: string): Promise<InferCheckResult | null> {
  const row = await CheckResult.findOne({ teamId, apiId }).sort({ checkedAt: -1 }).lean();
  if (!row) return null;
  return {
    status: row.status as CheckStatus,
    latencyMs: row.latencyMs,
    statusCode: row.statusCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    checkedAt: row.checkedAt,
  };
}

// "Current status" widget: Redis cache first (fast dashboard read, §6.4),
// Mongo as source of truth when the cache is cold.
export async function getCurrentStatus(teamId: string, apiId: string): Promise<InferCheckResult | null> {
  try {
    const raw = await getRedis().get(`status:${apiId}`);
    if (raw) {
      const cached = JSON.parse(raw) as { status: CheckStatus; latencyMs: number; lastCheckedAt: string };
      return {
        status: cached.status,
        latencyMs: cached.latencyMs,
        checkedAt: new Date(cached.lastCheckedAt),
      };
    }
  } catch {
    // Redis cold/down → fall through to Mongo.
  }
  return getLatestCheck(teamId, apiId);
}