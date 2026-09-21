import { config } from '../../config';
import { logger } from '../../lib/logger';

// Bill-safety guard, provider-agnostic (Claude or Groq). In-process per UTC
// day: the worker process is long-lived, so a zero-persistence counter is
// enough to hard-stop analysis once a daily budget is spent. AI_ENABLED=false
// is the master kill-switch that bypasses everything.

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

let currentDay = todayKey();
let callsToday = 0;

export function canSpendAiCall(): boolean {
  if (!config.aiEnabled) return false;
  const day = todayKey();
  if (day !== currentDay) {
    currentDay = day;
    callsToday = 0;
  }
  if (config.aiDailyCallCap <= 0) return false;
  if (callsToday >= config.aiDailyCallCap) {
    logger.warn(
      { cap: config.aiDailyCallCap, day },
      `ai analysis blocked: daily call cap reached`,
    );
    return false;
  }
  return true;
}

export function recordAiCall(): void {
  callsToday += 1;
}

// Test hook to reset the per-day counter.
export function resetDailyBudget(): void {
  currentDay = todayKey();
  callsToday = 0;
}