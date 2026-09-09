import { proxyActivities, sleep, continueAsNew } from '@temporalio/workflow';
import type * as activities from './activities';
import type { PingApiResult } from './activities';

const { pingApi, persistCheckResult } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
  },
});

export const CONTINUE_AS_NEW_AFTER_CHECKS = 200;

export interface HealthCheckWorkflowInput {
  apiId: string;
  teamId: string;
  intervalSeconds: number;
}

export type PersistedResult = Pick<PingApiResult, 'apiId' | 'teamId' | 'status' | 'latencyMs' | 'statusCode' | 'errorMessage'>;

export async function healthCheckWorkflow(input: HealthCheckWorkflowInput): Promise<void> {
  let iterations = 0;
  let intervalSeconds = input.intervalSeconds;

  for (;;) {
    if (iterations > 0 && iterations % CONTINUE_AS_NEW_AFTER_CHECKS === 0) {
      // Bound workflow history: same workflowId resumes with a fresh event history.
      await continueAsNew<typeof healthCheckWorkflow>({
        apiId: input.apiId,
        teamId: input.teamId,
        intervalSeconds,
      });
    }

    let result: PersistedResult;
    try {
      const probe = await pingApi(input.apiId);
      result = {
        apiId: probe.apiId,
        teamId: probe.teamId,
        status: probe.status,
        latencyMs: probe.latencyMs,
        statusCode: probe.statusCode,
        errorMessage: probe.errorMessage,
      };
      intervalSeconds = probe.intervalSeconds;
    } catch (err) {
      result = {
        apiId: input.apiId,
        teamId: input.teamId,
        status: 'DOWN',
        latencyMs: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    await persistCheckResult(result);

    await sleep(intervalSeconds * 1000);
    iterations++;
  }
}