import type { LatestCheck } from '@pulse/shared-types';

// Express/shareable "latest check" shape returned by the public endpoint.
export function latestCheckFrom(raw: {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  checkedAt: Date | string;
}): LatestCheck {
  return {
    status: raw.status,
    latencyMs: raw.latencyMs,
    statusCode: raw.statusCode,
    errorMessage: raw.errorMessage,
    checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : raw.checkedAt.toISOString(),
  };
}