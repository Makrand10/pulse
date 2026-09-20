import { config } from '../../config';

// Hard daily cap on paid Claude calls so a demo can never rack up a bill.
// Resets at UTC midnight; per-process state is fine because the worker is the
// only caller and this is a safety guard, not an exact accounting system.
const DAY_MS = 24 * 60 * 60 * 1000;

let dayStart = startOfUtcDay(Date.now());
let callsToday = 0;

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function canSpendClaudeCall(): boolean {
  const now = Date.now();
  if (now - dayStart >= DAY_MS) {
    dayStart = startOfUtcDay(now);
    callsToday = 0;
  }
  return callsToday < config.aiDailyCallCap;
}

export function recordClaudeCall(): void {
  callsToday += 1;
}

// Test helper: deterministic suites.
export function resetDailyBudget(): void {
  dayStart = startOfUtcDay(Date.now());
  callsToday = 0;
}