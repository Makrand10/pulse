// Temporal REST transport — used only by the Render Free demo deployment.
//
// Why this exists: Render's public edge serves HTTPS and does not carry gRPC,
// so a backend outside Render cannot use the SDK's native connection. The
// official Render REST-to-gRPC proxy
// (github.com/render-examples/temporal-rest-proxy) re-exposes the Temporal
// workflow service as REST, so the backend can start/terminate the exact same
// workflows over plain HTTP.
//
// Local development is untouched: TEMPORAL_TRANSPORT defaults to 'grpc' and
// keeps using the SDK connection in lifecycle.ts.
//
// Only the transport differs from the gRPC path. Workflow names, ids, task
// queue, arguments and cron schedule all stay identical, and the proxy is
// secured with a Bearer token (AUTH_TOKEN on the proxy side) that is read
// from the environment and never logged.
import { randomUUID } from 'node:crypto';
import { config } from '../config';

/** gRPC status code for ALREADY_EXISTS (WorkflowExecutionAlreadyStarted). */
const GRPC_CODE_ALREADY_EXISTS = 6;

/** Temporal payloads carry `json/plain` in the metadata encoding field. */
const JSON_PLAIN_ENCODING = Buffer.from('json/plain').toString('base64');

/** Never echo the bearer token back into an error message. */
function redact(text: string): string {
  const token = config.temporalAuthToken;
  if (!token) return text;
  return text.split(token).join('[redacted]');
}

export class TemporalRestError extends Error {
  readonly operation: string;
  readonly httpStatus: number;
  readonly grpcCode: number | undefined;

  constructor(operation: string, httpStatus: number, message: string, grpcCode?: number) {
    super(`${operation} failed (http ${httpStatus}): ${message}`);
    this.name = 'TemporalRestError';
    this.operation = operation;
    this.httpStatus = httpStatus;
    this.grpcCode = grpcCode;
  }

  /**
   * The workflow id is already running. The gRPC path swallows
   * WorkflowExecutionAlreadyStartedError to keep start idempotent; the proxy
   * reports the same condition as ALREADY_EXISTS (code 6) / HTTP 409.
   *
   * The status code alone is not enough: grpc-gateway maps both AlreadyExists
   * (6) and Aborted (10) to HTTP 409, so a genuine conflict would be mistaken
   * for success. When the body carries a code, trust it; only fall back to the
   * status for responses with no parsable body.
   */
  get isAlreadyStarted(): boolean {
    if (this.grpcCode !== undefined) return this.grpcCode === GRPC_CODE_ALREADY_EXISTS;
    return this.httpStatus === 409;
  }
}

interface RestRequestInit {
  method: 'GET' | 'POST';
  query?: Record<string, string>;
  body?: unknown;
}

async function restRequest<T>(operation: string, path: string, init: RestRequestInit): Promise<T> {
  const base = config.temporalRestUrl.replace(/\/+$/, '');
  if (!base) {
    throw new TemporalRestError(operation, 0, 'TEMPORAL_REST_URL is required when TEMPORAL_TRANSPORT=rest');
  }
  if (!config.temporalAuthToken) {
    throw new TemporalRestError(operation, 0, 'TEMPORAL_AUTH_TOKEN is required when TEMPORAL_TRANSPORT=rest');
  }

  const url = new URL(base + path);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.temporalRestTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.temporalAuthToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new TemporalRestError(operation, 0, redact(`request to ${url.host} failed: ${reason}`));
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const rpc = parsed as { code?: number; message?: string } | undefined;
    const message = rpc?.message ?? `unexpected response body: ${text.slice(0, 200)}`;
    throw new TemporalRestError(operation, response.status, redact(message), rpc?.code);
  }

  return parsed as T;
}

function namespacesPath(): string {
  return `/api/v1/namespaces/${encodeURIComponent(config.temporalNamespace)}`;
}

export interface StartWorkflowOptions {
  workflowId: string;
  workflowType: string;
  taskQueue: string;
  args?: unknown[];
  cronSchedule?: string;
}

export interface StartWorkflowResult {
  runId?: string;
}

/**
 * StartWorkflowExecution. Mirrors client.workflow.start(): same workflow type,
 * task queue, workflow id and args, plus cronSchedule for the rollup cron.
 * Throws TemporalRestError with isAlreadyStarted when the id is taken.
 */
export async function startWorkflowViaRest(options: StartWorkflowOptions): Promise<StartWorkflowResult> {
  const body: Record<string, unknown> = {
    workflowType: { name: options.workflowType },
    taskQueue: { name: options.taskQueue },
    requestId: randomUUID(),
    identity: 'pulse-backend',
  };

  if (options.cronSchedule) {
    body.cronSchedule = options.cronSchedule;
  }

  // One payload per argument, exactly like the SDK's default payload converter
  // (toPayloads(...args)). The proxy takes the same protobuf `Payloads` message,
  // and Temporal invokes the workflow with one positional argument per payload,
  // so a single-argument workflow must carry the argument itself - never an
  // array wrapping it. An empty arg list sends no input at all, matching the
  // SDK for `args: []` (uptimeRollupWorkflow takes no parameters).
  if (options.args && options.args.length > 0) {
    body.input = {
      payloads: options.args.map((arg) => ({
        data: Buffer.from(JSON.stringify(arg)).toString('base64'),
        metadata: { encoding: JSON_PLAIN_ENCODING },
      })),
    };
  }

  return restRequest<StartWorkflowResult>(
    'StartWorkflowExecution',
    `${namespacesPath()}/workflows/${encodeURIComponent(options.workflowId)}/start`,
    { method: 'POST', body },
  );
}

/**
 * WorkflowId equality in Temporal's SQL visibility query language. The proxy's
 * bundled ListWorkflowExecutionsRequest only has `namespace`, `page_size`,
 * `next_page_token` and `query`, so filtering has to go through `query`.
 */
function visibilityQueryForWorkflowId(workflowId: string): string {
  return `WorkflowId = '${workflowId.replace(/'/g, "''")}'`;
}

/**
 * Resolve the runId of the running execution. The proxy's terminate endpoint
 * requires a runId in the path (the SDK fills it in implicitly), so the current
 * run is looked up first.
 *
 * Only `query` and `pageSize` are sent: they are the fields this proxy's
 * generated gateway can actually populate. Unknown query parameters are
 * silently dropped by grpc-gateway (fieldByProtoName -> return nil) instead of
 * erroring, so sending e.g. `executionFilter.workflowId` or `maximumPageSize`
 * would quietly return an unfiltered page rather than fail.
 *
 * The returned execution is re-checked against the requested workflow id: if
 * the server ever returned something else we would otherwise terminate an
 * unrelated workflow.
 */
export async function findOpenRunIdViaRest(workflowId: string): Promise<string | null> {
  const response = await restRequest<{
    executions?: { execution?: { workflowId?: string; runId?: string } }[];
  }>('ListOpenWorkflowExecutions', `${namespacesPath()}/workflows/open`, {
    method: 'GET',
    query: { query: visibilityQueryForWorkflowId(workflowId), pageSize: '1' },
  });

  const execution = response.executions?.[0]?.execution;
  if (!execution?.runId) return null;
  if (execution.workflowId !== workflowId) return null;
  return execution.runId;
}

/**
 * Terminate the current run of a workflow. Returns false when no run is
 * open, which matches the gRPC path where terminating an already-finished
 * workflow is a no-op the caller swallows.
 */
export async function terminateWorkflowViaRest(workflowId: string, reason: string): Promise<boolean> {
  const runId = await findOpenRunIdViaRest(workflowId);
  if (!runId) return false;

  await restRequest(
    'TerminateWorkflowExecution',
    `${namespacesPath()}/workflows/${encodeURIComponent(workflowId)}/executions/${encodeURIComponent(runId)}/terminate`,
    { method: 'POST', body: { reason } },
  );
  return true;
}
