import { CheckResult } from '../../db/models/CheckResult';
import { Api } from '../../db/models/Api';
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