import { getRedis } from '../../lib/redis';
import { logger } from '../../lib/logger';

// Redis INCR + EXPIRE sliding-window rate limit for the public status
// endpoint (PRD §6 / M8): 60 requests per minute per client IP by default.
// Public endpoints must rate-limit without any auth state.

export interface StatusRateLimiter {
  (ip: string): Promise<boolean>;
}

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 60;
const KEY_PREFIX = 'rl:public-status:';

export function makeRedisStatusLimiter(limit = DEFAULT_LIMIT): StatusRateLimiter {
  return async (ip: string): Promise<boolean> => {
    try {
      const redis = getRedis();
      const key = `${KEY_PREFIX}${ip}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, WINDOW_SECONDS);
      if (count > limit) return false;
    } catch (err) {
      // Redis is best-effort on this path (mirrors the status cache): a Redis
      // blip must never take the public page down, so fail open and log.
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'public status rate limit degraded; allowing request');
    }
    return true;
  };
}

let limiter: StatusRateLimiter = makeRedisStatusLimiter();

export function checkStatusRateLimit(ip: string): Promise<boolean> {
  return limiter(ip);
}

// Test hook (same pattern as setEmailSender / setErrorLogger).
export function setStatusRateLimiterForTests(next: StatusRateLimiter): void {
  limiter = next;
}