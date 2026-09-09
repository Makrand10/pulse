import type { CheckStatus } from '@pulse/shared-types';

export type StreakDecision = 'OPEN' | 'RESOLVE' | 'NOOP';

export const DEFAULT_FAILURE_THRESHOLD = 3;
export const DEFAULT_SUCCESS_THRESHOLD = 2;

const isFailure = (status: CheckStatus): boolean => status === 'DOWN';
const isSuccess = (status: CheckStatus): boolean => status !== 'DOWN';

function trailingRun(results: CheckStatus[], predicate: (s: CheckStatus) => boolean): number {
  let run = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (!predicate(results[i])) break;
    run++;
  }
  return run;
}

// Pure incident state machine. recentResults must be chronological
// (oldest → newest). Returns the transition to take for the current check:
//   - incident not open + N consecutive failures      → 'OPEN'
//   - incident open     + M consecutive successes     → 'RESOLVE'
//   - otherwise                                        → 'NOOP'
// An already-open incident never emits 'OPEN' again, so a partial recovery
// followed by another failure keeps the existing incident open instead of
// reopening/duplicating it.
export function evaluateStreak(
  recentResults: CheckStatus[],
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  successThreshold = DEFAULT_SUCCESS_THRESHOLD,
  incidentOpen = false,
): StreakDecision {
  if (recentResults.length === 0) return 'NOOP';

  if (incidentOpen) {
    return trailingRun(recentResults, isSuccess) >= successThreshold ? 'RESOLVE' : 'NOOP';
  }

  return trailingRun(recentResults, isFailure) >= failureThreshold ? 'OPEN' : 'NOOP';
}