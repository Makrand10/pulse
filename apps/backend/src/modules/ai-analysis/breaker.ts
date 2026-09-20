// Minimal in-memory circuit breaker for the Claude call: after N consecutive
// failures inside the cooldown window, the analysis is skipped (aiSummary=null)
// instead of hammering a degraded provider. Per-process state is enough for v1;
// the queue provides the durable retry path.
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let openedAt: number | null = null;

export function canAttemptClaude(): boolean {
  if (openedAt === null) return true;
  if (Date.now() - openedAt >= COOLDOWN_MS) {
    openedAt = null;
    consecutiveFailures = 0;
    return true;
  }
  return false;
}

export function recordClaudeSuccess(): void {
  if (openedAt === null) consecutiveFailures = 0;
}

export function recordClaudeFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    openedAt = Date.now();
  }
}

// Test helper only: resets between suites so in-memory breaker state is
// deterministic (FR-Traceable: DoD runs must not depend on other tests).
export function resetBreaker(): void {
  consecutiveFailures = 0;
  openedAt = null;
}