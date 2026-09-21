import { Connection, Client, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { config } from '../config';
import {
  TASK_QUEUE,
  WORKFLOW_NAME,
  UPTIME_WORKFLOW_ID,
  UPTIME_WORKFLOW_NAME,
  UPTIME_CRON_SCHEDULE,
  workflowIdForApi,
} from './shared';

let clientPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({ address: config.temporalAddress });
      return new Client({ connection, namespace: config.temporalNamespace });
    })();
  }
  return clientPromise;
}

// Idempotent start: starting with an existing workflowId is a no-op success.
export async function startHealthCheckWorkflow(
  apiId: string,
  teamId: string,
  intervalSeconds: number,
): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.start(WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId: workflowIdForApi(apiId),
    args: [{ apiId, teamId, intervalSeconds }],
  });
  try {
    await handle;
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
  }
}

export async function stopHealthCheckWorkflow(apiId: string): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowIdForApi(apiId));
  try {
    await handle.terminate('api deactivated or deleted');
  } catch {
    // workflow already gone — nothing to do
  }
}

// Idempotent hourly cron, started at boot. Fixed workflowId means a deploy
// restart re-schedules the same workflow instead of stacking duplicates.
export async function startUptimeRollupWorkflow(): Promise<void> {
  const client = await getClient();
  const handle = client.workflow.start(UPTIME_WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId: UPTIME_WORKFLOW_ID,
    cronSchedule: UPTIME_CRON_SCHEDULE,
    args: [],
  });
  try {
    await handle;
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
  }
}