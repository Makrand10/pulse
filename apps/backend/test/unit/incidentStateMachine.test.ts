import { describe, it, expect } from 'vitest';
import { evaluateStreak, DEFAULT_FAILURE_THRESHOLD, DEFAULT_SUCCESS_THRESHOLD } from '../../src/modules/incidents/stateMachine';
import type { CheckStatus, StreakDecision } from '../../src/modules/incidents/stateMachine';

const N = DEFAULT_FAILURE_THRESHOLD; // 3
const M = DEFAULT_SUCCESS_THRESHOLD; // 2

interface Case {
  name: string;
  results: CheckStatus[];
  incidentOpen: boolean;
  failureThreshold?: number;
  successThreshold?: number;
  expected: StreakDecision;
}

const CASES: Case[] = [
  // DoD: single blip — no incident
  {
    name: 'single blip when no incident is open → NOOP',
    results: ['UP', 'DOWN', 'UP'],
    incidentOpen: false,
    expected: 'NOOP',
  },
  {
    name: 'isolated DOWN at the tail (not yet N) → NOOP',
    results: ['UP', 'UP', 'DOWN'],
    incidentOpen: false,
    expected: 'NOOP',
  },
  // DoD: N-in-a-row opens
  {
    name: 'N consecutive failures → OPEN',
    results: ['UP', 'DOWN', 'DOWN', 'DOWN'],
    incidentOpen: false,
    expected: 'OPEN',
  },
  {
    name: 'exact N failures from the start → OPEN',
    results: ['DOWN', 'DOWN', 'DOWN'],
    incidentOpen: false,
    expected: 'OPEN',
  },
  {
    name: 'custom N honored',
    results: ['UP', 'DOWN', 'DOWN'],
    incidentOpen: false,
    failureThreshold: 2,
    expected: 'OPEN',
  },
  {
    name: 'DEGRADED does not count as a failure for opening',
    results: ['DOWN', 'DOWN', 'DEGRADED'],
    incidentOpen: false,
    expected: 'NOOP',
  },
  // DoD: open → partial recovery → fail again — stays open, no reopen/duplicate
  {
    name: 'open incident, partial recovery then a failure → NOOP (stays open)',
    results: ['DOWN', 'DOWN', 'UP', 'DOWN'],
    incidentOpen: true,
    expected: 'NOOP',
  },
  {
    name: 'open incident, another full run of failures → NOOP (no duplicate OPEN)',
    results: ['UP', 'UP', 'DOWN', 'DOWN', 'DOWN'],
    incidentOpen: true,
    expected: 'NOOP',
  },
  // DoD: open → M-in-a-row auto-resolves
  {
    name: 'open incident with M consecutive successes → RESOLVE',
    results: ['DOWN', 'UP', 'UP'],
    incidentOpen: true,
    expected: 'RESOLVE',
  },
  {
    name: 'open incident with >M successes → RESOLVE',
    results: ['DOWN', 'DOWN', 'UP', 'DEGRADED', 'UP'],
    incidentOpen: true,
    expected: 'RESOLVE',
  },
  {
    name: 'open incident with fewer than M successes → NOOP',
    results: ['DOWN', 'UP'],
    incidentOpen: true,
    expected: 'NOOP',
  },
  {
    name: 'custom M honored',
    results: ['DOWN', 'DOWN', 'UP', 'UP', 'UP'],
    incidentOpen: true,
    successThreshold: 3,
    expected: 'RESOLVE',
  },
  // guards
  {
    name: 'empty history → NOOP',
    results: [],
    incidentOpen: false,
    expected: 'NOOP',
  },
  {
    name: 'RESOLVE is never emitted when no incident is open',
    results: ['UP', 'UP'],
    incidentOpen: false,
    expected: 'NOOP',
  },
];

describe('evaluateStreak — pure incident state machine', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(
        evaluateStreak(c.results, c.failureThreshold ?? N, c.successThreshold ?? M, c.incidentOpen),
      ).toBe(c.expected);
    });
  }
});