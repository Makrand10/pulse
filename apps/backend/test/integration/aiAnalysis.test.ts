import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { Incident } from '../../src/db/models/Incident';
import { createIncident } from '../../src/modules/incidents/repository';
import { applyIncidentEngine } from '../../src/modules/incidents/engine';
import { setClaudeClient, getClaudeClient, type ClaudeClient } from '../../src/modules/ai-analysis/claude';
import { runAnalysis } from '../../src/modules/ai-analysis/graph';
import { processAiAnalysisJob, type AiAnalysisJobData } from '../../src/modules/ai-analysis/queue';
import { resetBreaker } from '../../src/modules/ai-analysis/breaker';
import { resetDailyBudget } from '../../src/modules/ai-analysis/budget';
import { config } from '../../src/config';
import type { CheckStatus } from '@pulse/shared-types';

let mongo: MongoMemoryServer;
let previousClient: ClaudeClient;
let claudeCalls = 0;

// Strictly increasing clock so health-check batches stay chronological.
let clockMs = Date.now();
let nextClock = () => (clockMs += 1000);

function fakeJob(data: AiAnalysisJobData, attemptsMade: number, id: string): never {
  return {
    id,
    name: 'ai-incident-analysis',
    data,
    opts: { attempts: 2 },
    attemptsMade,
  } as never;
}

async function createApi(teamId: string): Promise<string> {
  const api = await Api.create({ teamId, name: 'Payments API', url: 'https://api.example.com/status' });
  return String(api._id);
}

async function recordStatuses(teamId: string, apiId: string, statuses: CheckStatus[]): Promise<void> {
  await CheckResult.insertMany(
    statuses.map((status) => ({
      teamId,
      apiId,
      status,
      latencyMs: status === 'DOWN' ? 0 : 50,
      checkedAt: new Date(nextClock()),
    })),
  );
}

async function openIncident(teamId: string): Promise<{ apiId: string; incidentId: string }> {
  const apiId = await createApi(teamId);
  const incident = await createIncident(teamId, apiId, 'opened');
  return { apiId, incidentId: String(incident._id) };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  previousClient = getClaudeClient();
}, 120000);

afterAll(async () => {
  setClaudeClient(previousClient);
  await disconnectDb();
  if (mongo) await mongo.stop();
});

beforeEach(() => {
  claudeCalls = 0;
  resetBreaker();
});

afterEach(() => {
  setClaudeClient(previousClient);
});

describe('M6 DoD: root-cause graph (§6.6)', () => {
  it('(a) short-circuits before calling Claude when failure history is empty', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);

    setClaudeClient({
      async analyze() {
        claudeCalls += 1;
        throw new Error('should never be called');
      },
    });

    await runAnalysis({ teamId, apiId, incidentId });

    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSummary).toBeNull();
    expect(stored!.aiSuggestedCause).toBeNull();
    expect(claudeCalls).toBe(0);
  });

  it('runs the full graph and persists aiSummary/aiSuggestedCause', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze({ prompt }) {
        claudeCalls += 1;
        expect(prompt).toMatch(/grounding/i);
        return {
          summary: 'Three consecutive 5xx failures',
          suggestedCause: 'Likely service saturation',
          nextDebugStep: 'Check pod CPU and error rate',
        };
      },
    });

    await runAnalysis({ teamId, apiId, incidentId });

    const stored = await Incident.findOne({ teamId });
    expect(claudeCalls).toBe(1);
    expect(stored!.aiSummary).toBe('Three consecutive 5xx failures');
    expect(stored!.aiSuggestedCause).toBe('Likely service saturation');
  });

  it('persists null on a mocked Claude timeout without dropping the run', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze() {
        claudeCalls += 1;
        throw new Error('Request timed out after 10000ms');
      },
    });

    // Simulated BullMQ delivery #1 (initial): the run persists null and
    // rethrows so BullMQ performs the single PRD retry — the parent flow never
    // sees the failure (DoD (b)).
    await expect(processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, 0, 'job-1'))).rejects.toThrow(
      'Request timed out',
    );

    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSummary).toBeNull();
    expect(stored!.aiSuggestedCause).toBeNull();
    expect(claudeCalls).toBe(1);
  });
});

describe('M6 DoD: incident creation path is never blocked by AI', () => {
  it('(b) a Claude timeout does not throw out of incident creation', async () => {
    const teamId = new Types.ObjectId().toString();
    const apiId = await createApi(teamId);
    await recordStatuses(teamId, apiId, ['UP', 'DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze() {
        throw new Error('Request timed out after 10000ms');
      },
    });

    // Same flow as the Temporal activity: persist → engine. If the AI work
    // were awaited, this would throw; it must not happen here.
    await applyIncidentEngine({ apiId, teamId });

    const incident = await Incident.findOne({ apiId, teamId });
    expect(incident).not.toBeNull();
    expect(incident!.status).toBe('OPEN');
    expect(incident!.aiSummary).toBeNull();
  });

  it('stays null after queue retries are exhausted (nothing thrown upward)', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze() {
        claudeCalls += 1;
        throw new Error('Request timed out');
      },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, attempt, `job-${attempt}`))).rejects.toThrow(
        'Request timed out',
      );
    }

    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSummary).toBeNull();
    expect(claudeCalls).toBe(2);
  });

  it('skips Claude entirely while the circuit breaker is open', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    // Trip the breaker with three consecutive failures (initial deliveries).
    setClaudeClient({
      async analyze() {
        throw new Error('Request timed out');
      },
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, attempt, `trip-${attempt}`))).rejects.toThrow();
    }
    const callsWhileFailing = claudeCalls;

    // Breaker now open: a new delivery skips Claude and persists null instead.
    const result = await processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, 0, 'open'));
    expect(result).toBeUndefined();
    expect(claudeCalls).toBe(callsWhileFailing); // no new Claude call
    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSummary).toBeNull();
  });
});

describe('bill safety: provider calls are capped and kill-switchable', () => {
  const mutableConfig = config as unknown as { aiDailyCallCap: number; aiEnabled: boolean };

  beforeEach(() => {
    resetDailyBudget();
  });

  afterEach(() => {
    mutableConfig.aiDailyCallCap = 10;
    mutableConfig.aiEnabled = true;
    resetDailyBudget();
  });

  it('never calls the provider once the daily budget is exhausted', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze() {
        claudeCalls += 1;
        return { summary: 'Saturation', suggestedCause: 'CPU', nextDebugStep: 'Check pods' };
      },
    });

    mutableConfig.aiDailyCallCap = 1;

    await processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, 0, 'budget-1'));
    expect(claudeCalls).toBe(1);

    // Second delivery: budget (cap=1) is spent — provider must not be called.
    await processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, 0, 'budget-2'));
    expect(claudeCalls).toBe(1);

    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSuggestedCause).toBeNull(); // blocked run persisted null
  });

  it('AI_ENABLED=false hard-stops analysis without calling the provider', async () => {
    const teamId = new Types.ObjectId().toString();
    const { apiId, incidentId } = await openIncident(teamId);
    await recordStatuses(teamId, apiId, ['DOWN', 'DOWN', 'DOWN']);

    setClaudeClient({
      async analyze() {
        claudeCalls += 1;
        throw new Error('should never be called');
      },
    });

    mutableConfig.aiEnabled = false;
    const result = await processAiAnalysisJob(fakeJob({ teamId, apiId, incidentId }, 0, 'disabled'));
    expect(result).toBeUndefined();
    expect(claudeCalls).toBe(0);

    const stored = await Incident.findOne({ teamId });
    expect(stored!.aiSummary).toBeNull();
  });
});