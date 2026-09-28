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
import { TemporalRestError, startWorkflowViaRest, terminateWorkflowViaRest } from './restClient';

let clientPromise: Promise<Client> | null = null;

// Transport selection only. 'grpc' (default) uses the SDK connection below;
// 'rest' (Render demo) sends the same start/terminate calls to the official
// Render REST-to-gRPC proxy. Workflow names, ids, task queue, arguments and
// cron schedule are identical on both paths.
function usingRestTransport(): boolean {
  return config.temporalTransport === 'rest';
}

// The SDK raises WorkflowExecutionAlreadyStartedError; the proxy reports the
// same condition as gRPC ALREADY_EXISTS. Start stays idempotent either way.
function isAlreadyStarted(err: unknown): boolean {
  if (err instanceof WorkflowExecutionAlreadyStartedError) return true;
  return err instanceof TemporalRestError && err.isAlreadyStarted;
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: config.temporalAddress,
        tls: config.temporalTls ? {} : false,
      });
      return new Client({ connection, namespace: config.temporalNamespace });
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

// Idempotent start: starting with an existing workflowId is a no-op success.
export async function startHealthCheckWorkflow(
  apiId: string,
  teamId: string,
  intervalSeconds: number,
): Promise<void> {
  const workflowId = workflowIdForApi(apiId);

  if (usingRestTransport()) {
    try {
      await startWorkflowViaRest({
        workflowId,
        workflowType: WORKFLOW_NAME,
        taskQueue: TASK_QUEUE,
        args: [{ apiId, teamId, intervalSeconds }],
      });
    } catch (err) {
      if (!isAlreadyStarted(err)) throw err;
    }
    return;
  }

  const client = await getClient();
  const handle = client.workflow.start(WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{ apiId, teamId, intervalSeconds }],
  });
  try {
    await handle;
  } catch (err) {
    if (!isAlreadyStarted(err)) throw err;
  }
}

export async function stopHealthCheckWorkflow(apiId: string): Promise<void> {
  const workflowId = workflowIdForApi(apiId);

  if (usingRestTransport()) {
    // Same tolerance as the gRPC path below: a workflow that is already gone
    // is a successful stop, so every failure here is swallowed.
    try {
      await terminateWorkflowViaRest(workflowId, 'api deactivated or deleted');
    } catch {
      // nothing to terminate
    }
    return;
  }

  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  try {
    await handle.terminate('api deactivated or deleted');
  } catch {
    // workflow already gone — nothing to do
  }
}

// Idempotent hourly cron, started at boot. Fixed workflowId means a deploy
// restart re-schedules the same workflow instead of stacking duplicates.
export async function startUptimeRollupWorkflow(): Promise<void> {
  if (usingRestTransport()) {
    try {
      await startWorkflowViaRest({
        workflowId: UPTIME_WORKFLOW_ID,
        workflowType: UPTIME_WORKFLOW_NAME,
        taskQueue: TASK_QUEUE,
        cronSchedule: UPTIME_CRON_SCHEDULE,
        args: [],
      });
    } catch (err) {
      if (!isAlreadyStarted(err)) throw err;
    }
    return;
  }

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
    if (!isAlreadyStarted(err)) throw err;
  }
}
