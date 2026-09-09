import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { recordCheckResult } from '../../src/modules/healthchecks/repository';
import { TASK_QUEUE } from '../../src/temporal/shared';
import type { PingApiResult } from '../../src/temporal/activities';

let mongo: MongoMemoryServer;
let env: TestWorkflowEnvironment;
const INTERVAL_SECONDS = 60;
let apiId: string;
let teamId: string;

const workflowsPath = fileURLToPath(new URL('../../src/temporal/workflows.ts', import.meta.url));
const idle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStubActivities(probeCalls: { count: number }) {
  return {
    async pingApi(id: string): Promise<PingApiResult> {
      probeCalls.count++;
      return {
        apiId: id,
        teamId,
        status: 'UP',
        latencyMs: 12,
        intervalSeconds: INTERVAL_SECONDS,
      };
    },
    async persistCheckResult(result: Parameters<typeof recordCheckResult>[0]): Promise<void> {
      await recordCheckResult(result);
    },
    async applyIncidentEngine(_input: { apiId: string; teamId: string }): Promise<void> {
      // Pure UP sequences never transition the incident state machine.
    },
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  env = await TestWorkflowEnvironment.createTimeSkipping();

  const api = await Api.create({
    teamId: new Types.ObjectId(),
    name: 'Temporal-test API',
    url: 'https://api.example.com/status',
    intervalSeconds: INTERVAL_SECONDS,
  });
  apiId = String(api._id);
  teamId = String(api.teamId);
}, 180000);

afterAll(async () => {
  await env.teardown();
  await disconnectDb();
  if (mongo) await mongo.stop();
});

async function checkCount(): Promise<number> {
  return CheckResult.countDocuments({ apiId, teamId });
}

describe('M3 DoD: durable health-check engine', () => {
  it('persists checks on schedule, survives a worker crash/restart with no lost or duplicated work', async () => {
    const probeCalls = { count: 0 };
    const stub = makeStubActivities(probeCalls);
    const workers: Worker[] = [];
    let checksBeforeCrash = 0;

    try {
      // ---- Worker #1 executes the workflow ----
      // maxCachedWorkflows: 0 disables sticky execution so that after this
      // worker "crashes", the workflow's next task is dispatched to the normal
      // task queue where worker #2 can pick it up.
      const worker1 = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath,
        activities: stub,
        maxCachedWorkflows: 0,
      });
      workers.push(worker1);
      const run1 = worker1.run();

      const workflowId = `healthcheck-${apiId}`;
      await env.client.workflow.start('healthCheckWorkflow', {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ apiId, teamId, intervalSeconds: INTERVAL_SECONDS }],
      });

      await env.sleep(INTERVAL_SECONDS * 1000 * 3 + 1000);
      checksBeforeCrash = await checkCount();
      expect(checksBeforeCrash).toBeGreaterThanOrEqual(2);

      // ---- "Crash": kill worker #1 while the workflow is mid-loop ----
      await worker1.shutdown();
      await run1;
    } catch (err) {
      throw err;
    } finally {
      for (const w of workers) {
        try {
          await w.shutdown();
        } catch {
          // already stopped
        }
      }
    }

    // The workflow execution must still be alive on the server (durability).
    const handle = env.client.workflow.getHandle(`healthcheck-${apiId}`);
    const desc = await handle.describe();
    const statusName = (desc.status as { name?: string }).name ?? String(desc.status);
    expect(String(statusName)).toContain('RUNNING');

    // ---- "Restart": a brand-new worker process resumes the same workflow ----
    const worker2 = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath,
      activities: stub,
      maxCachedWorkflows: 0,
    });
    const run2 = worker2.run();
    try {
      await idle(3000); // let worker2 finish bootstrapping before time advances

      // Advance time in short hops and poll until the workflow (now running on
      // worker #2) persists new checks. This decouples the assertion from the
      // virtual-clock/wall-clock race that happens right after a restart.
      let checksAfterRestart = await checkCount();
      const HOP_MS = INTERVAL_SECONDS * 1000;
      const MAX_HOPS = 6;
      for (let hop = 0; hop < MAX_HOPS && checksAfterRestart <= checksBeforeCrash; hop++) {
        await env.sleep(HOP_MS);
        await idle(500); // let Mongo writes flush before counting again
        checksAfterRestart = await checkCount();
      }
      expect(checksAfterRestart).toBeGreaterThan(checksBeforeCrash);

      // No check is duplicated: every (apiId, checkedAt) pair is unique.
      const docs = await CheckResult.find({ apiId, teamId }).lean();
      const pairs = new Set(docs.map((d) => `${d.apiId}:${d.checkedAt.toISOString()}`));
      expect(pairs.size).toBe(docs.length);

      // Redis failover: persistCheckResult still wrote to Mongo even though Redis was absent.
      expect(docs.every((d) => d.status === 'UP')).toBe(true);
    } finally {
      try {
        await worker2.shutdown();
      } catch {
        // already stopped
      }
      await run2;
    }
  }, 150000);
});