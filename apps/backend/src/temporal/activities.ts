import { ApplicationFailure } from '@temporalio/common';
import { decryptSecret } from '../modules/apis/crypto';
import { recordCheckResult, computeHourlyUptimeRollups, getApiForWorker } from '../modules/healthchecks/repository';
import type { CheckStatus } from '@pulse/shared-types';

// Re-exported engine runner: Temporal registers this exported activity and the
// worker will pick it up automatically (worker.ts imports `* as activities`).
export { applyIncidentEngine } from '../modules/incidents/engine';

const PROBE_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 1_000, 2_000]; // exponential backoff, as a total of 3 attempts (PRD §7.3)

export interface PingApiResult {
  apiId: string;
  teamId: string;
  status: CheckStatus;
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  intervalSeconds: number;
}

function isTransient(statusCode: number): boolean {
  return statusCode >= 500 && statusCode <= 599;
}

async function probe(url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number): Promise<{ statusCode: number; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
    await res.arrayBuffer(); // drain body so keep-alive sockets are reusable
    return { statusCode: res.status, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export async function pingApi(apiId: string): Promise<PingApiResult> {
  const api = await getApiForWorker(apiId);
  if (!api) {
    throw ApplicationFailure.nonRetryable(`api ${apiId} not found`);
  }

  const headers: Record<string, string> = { Accept: '*/*', ...api.headers };
  if (api.authTokenEncrypted) {
    headers.Authorization = `Bearer ${decryptSecret(api.authTokenEncrypted)}`;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt] ?? 2_000));
    }
    try {
      const { statusCode, latencyMs } = await probe(api.url, api.method, headers, api.body, PROBE_TIMEOUT_MS);
      if (isTransient(statusCode)) {
        lastError = new Error(`HTTP ${statusCode} (transient, attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        continue; // 5xx => transient => retry
      }
      let status: CheckStatus;
      if (statusCode === api.expectedStatus) {
        status = latencyMs > api.latencyThresholdMs ? 'DEGRADED' : 'UP';
      } else {
        status = 'DOWN'; // clean 4xx/3xx-mismatch: terminal, no retry
      }
      return { apiId: api.apiId, teamId: api.teamId, status, latencyMs, statusCode, intervalSeconds: api.intervalSeconds };
    } catch (err) {
      lastError = err; // network error / timeout => transient => retry
    }
  }

  // All retries exhausted (timeout or repeated 5xx). Surface as a failure so
  // Temporal's retry policy + the workflow catch-path record a DOWN result.
  throw ApplicationFailure.retryable(`health check failed after ${MAX_ATTEMPTS} attempts: ${(lastError as Error).message}`);
}

export async function persistCheckResult(result: Pick<PingApiResult, 'apiId' | 'teamId' | 'status' | 'latencyMs' | 'statusCode' | 'errorMessage'>): Promise<void> {
  await recordCheckResult(result);
}

// Hourly §6.4 aggregation. Returns the number of buckets written so the
// workflow can log a meaningful summary.
export async function computeUptimeRollups(): Promise<number> {
  return computeHourlyUptimeRollups();
}