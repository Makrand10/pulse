import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Connection } from '@temporalio/client';
import { config } from '../../src/config';
import {
  TemporalRestError,
  startWorkflowViaRest,
  findOpenRunIdViaRest,
  terminateWorkflowViaRest,
} from '../../src/temporal/restClient';
import {
  startHealthCheckWorkflow,
  stopHealthCheckWorkflow,
  startUptimeRollupWorkflow,
} from '../../src/temporal/lifecycle';
import {
  TASK_QUEUE,
  WORKFLOW_NAME,
  UPTIME_WORKFLOW_ID,
  UPTIME_WORKFLOW_NAME,
  UPTIME_CRON_SCHEDULE,
  workflowIdForApi,
} from '../../src/temporal/shared';
import {
  FakeRestProxy,
  decodePayloads,
  extractWorkflowIdFilter,
  grpcCodeToHttpStatus,
} from '../helpers/fakeRestProxy';

const TOKEN = 'super-secret-temporal-token';
const REST_URL = 'https://pulse-temporal-demo.onrender.com';
const NAMESPACE = 'default';

const realFetch = globalThis.fetch;

let proxy: FakeRestProxy;

function setConfig(overrides: Record<string, unknown> = {}) {
  Object.assign(config as unknown as Record<string, unknown>, {
    temporalTransport: 'rest',
    temporalRestUrl: REST_URL,
    temporalAuthToken: TOKEN,
    temporalNamespace: NAMESPACE,
    temporalAddress: 'localhost:7233',
    temporalTls: false,
    ...overrides,
  });
}

function startRequest() {
  const last = proxy.requests.at(-1);
  if (!last) throw new Error('no request was made');
  return last;
}

function srcPath(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

beforeEach(() => {
  setConfig();
  proxy = new FakeRestProxy(TOKEN);
  proxy.install();
});

afterEach(() => {
  FakeRestProxy.restore(realFetch);
  vi.restoreAllMocks();
  setConfig({ temporalTransport: 'grpc', temporalRestUrl: '', temporalAuthToken: '' });
});

describe('proxy contract: the transport mirrors the real gateway', () => {
  it('maps both AlreadyExists and Aborted to HTTP 409, so the status alone is ambiguous', () => {
    expect(grpcCodeToHttpStatus(6)).toBe(409);
    expect(grpcCodeToHttpStatus(10)).toBe(409);
    expect(grpcCodeToHttpStatus(13)).toBe(500);
    expect(grpcCodeToHttpStatus(16)).toBe(401);
  });

  it('parses the visibility query the same way the server does', () => {
    expect(extractWorkflowIdFilter("WorkflowId = 'healthcheck-api-1'")).toBe('healthcheck-api-1');
    expect(extractWorkflowIdFilter("WorkflowType = 'healthCheckWorkflow'")).toBeUndefined();
  });
});

describe('proxy contract: request shape', () => {
  it('starts the workflow on the annotated path with workflow type and task queue', async () => {
    await startHealthCheckWorkflow('api-1', 'team-1', 60);

    const request = startRequest();
    expect(request.method).toBe('POST');
    expect(request.path).toBe(`/api/v1/namespaces/${NAMESPACE}/workflows/${workflowIdForApi('api-1')}/start`);
    expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(request.headers['Content-Type']).toBe('application/json');
    expect(request.body).toMatchObject({
      workflowType: { name: WORKFLOW_NAME },
      taskQueue: { name: TASK_QUEUE },
    });
    expect(request.body).toHaveProperty('requestId');
  });

  it('sends exactly one payload containing the argument object itself', async () => {
    await startHealthCheckWorkflow('api-1', 'team-1', 60);

    const payloads = decodePayloads(startRequest().body);
    expect(payloads).toHaveLength(1);
    // The workflow's first positional argument must be the object, not an array
    // wrapping it - Temporal binds one argument per payload.
    expect(payloads[0].encoding).toBe('json/plain');
    expect(payloads[0].data).toEqual({ apiId: 'api-1', teamId: 'team-1', intervalSeconds: 60 });
    expect(Array.isArray(payloads[0].data)).toBe(false);
  });

  it('sends one payload per argument, in order, for multi-argument workflows', async () => {
    await startWorkflowViaRest({
      workflowId: 'multi-arg',
      workflowType: WORKFLOW_NAME,
      taskQueue: TASK_QUEUE,
      args: [{ apiId: 'api-1' }, { teamId: 'team-1' }, 60],
    });

    const payloads = decodePayloads(startRequest().body);
    expect(payloads.map((payload) => payload.data)).toEqual([{ apiId: 'api-1' }, { teamId: 'team-1' }, 60]);
    expect(payloads.every((payload) => payload.encoding === 'json/plain')).toBe(true);
  });

  it('omits input entirely for the no-argument uptime rollup workflow', async () => {
    await startUptimeRollupWorkflow();

    const request = startRequest();
    expect(request.path).toBe(`/api/v1/namespaces/${NAMESPACE}/workflows/${UPTIME_WORKFLOW_ID}/start`);
    expect(request.body).not.toHaveProperty('input');
    expect(request.body).toMatchObject({
      workflowType: { name: UPTIME_WORKFLOW_NAME },
      taskQueue: { name: TASK_QUEUE },
      cronSchedule: UPTIME_CRON_SCHEDULE,
    });
  });

  it('looks a workflow up with the only query parameters this proxy supports', async () => {
    proxy.workflows.set('healthcheck-api-1', { workflowId: 'healthcheck-api-1', runId: 'run-1' });
    await stopHealthCheckWorkflow('api-1');

    const lookup = proxy.requests[0];
    expect(lookup.method).toBe('GET');
    expect(lookup.path).toBe(`/api/v1/namespaces/${NAMESPACE}/workflows/open`);
    expect(Object.keys(lookup.query).sort()).toEqual(['pageSize', 'query']);
    expect(lookup.query.pageSize).toBe('1');
    expect(extractWorkflowIdFilter(lookup.query.query)).toBe('healthcheck-api-1');
  });

  it('never sends filter parameters the proxy silently drops', async () => {
    proxy.workflows.set('healthcheck-api-1', { workflowId: 'healthcheck-api-1', runId: 'run-1' });
    await stopHealthCheckWorkflow('api-1');

    // The gateway ignores unknown query params instead of erroring, so a bad
    // filter would look like it worked while returning an unfiltered page.
    expect(proxy.ignoredQueryParams).toEqual([]);
  });
});

describe('proxy contract: start idempotency', () => {
  it('treats AlreadyExists (code 6, HTTP 409) as already started', async () => {
    await startHealthCheckWorkflow('api-1', 'team-1', 60);
    await expect(startHealthCheckWorkflow('api-1', 'team-1', 60)).resolves.toBeUndefined();
  });

  it('does NOT treat Aborted (code 10, also HTTP 409) as already started', async () => {
    proxy.forcedFailure = { code: 10, message: 'workflow is being modified concurrently' };

    await expect(startHealthCheckWorkflow('api-1', 'team-1', 60)).rejects.toThrow(
      /workflow is being modified concurrently/,
    );
  });

  it('still surfaces unrelated start failures', async () => {
    proxy.forcedFailure = { code: 13, message: 'internal error' };
    await expect(startHealthCheckWorkflow('api-1', 'team-1', 60)).rejects.toThrow(/internal error/);
  });

  it('classifies the codes explicitly', async () => {
    proxy.forcedFailure = { code: 6, message: 'workflow execution already started' };
    await expect(startWorkflowViaRest({ workflowId: 'x', workflowType: WORKFLOW_NAME, taskQueue: TASK_QUEUE })).rejects.toSatisfy(
      (err: TemporalRestError) => err.isAlreadyStarted && err.grpcCode === 6 && err.httpStatus === 409,
    );

    proxy.forcedFailure = { code: 10, message: 'aborted' };
    await expect(startWorkflowViaRest({ workflowId: 'x', workflowType: WORKFLOW_NAME, taskQueue: TASK_QUEUE })).rejects.toSatisfy(
      (err: TemporalRestError) => !err.isAlreadyStarted && err.grpcCode === 10 && err.httpStatus === 409,
    );
  });
});

describe('proxy contract: termination', () => {
  it('resolves the runId and terminates that exact execution with the reason', async () => {
    proxy.workflows.set('healthcheck-api-1', { workflowId: 'healthcheck-api-1', runId: 'run-1' });

    await stopHealthCheckWorkflow('api-1');

    const terminate = proxy.requests.at(-1)!;
    expect(terminate.method).toBe('POST');
    expect(terminate.path).toBe(
      `/api/v1/namespaces/${NAMESPACE}/workflows/healthcheck-api-1/executions/run-1/terminate`,
    );
    expect(terminate.body).toEqual({ reason: 'api deactivated or deleted' });
    expect(proxy.workflows.get('healthcheck-api-1')?.terminated).toBe(true);
  });

  it('does not terminate an unrelated workflow the lookup might return', async () => {
    // A server that ignored the filter returns someone else's execution; the
    // client must refuse to terminate it.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ executions: [{ execution: { workflowId: 'someone-elses-workflow', runId: 'run-9' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    await expect(findOpenRunIdViaRest('healthcheck-api-1')).resolves.toBeNull();
    await expect(terminateWorkflowViaRest('healthcheck-api-1', 'gone')).resolves.toBe(false);
  });

  it('treats a workflow with no open run as already stopped', async () => {
    await expect(findOpenRunIdViaRest('healthcheck-api-1')).resolves.toBeNull();
    await expect(stopHealthCheckWorkflow('api-1')).resolves.toBeUndefined();
    expect(proxy.requests.some((request) => request.path.endsWith('/terminate'))).toBe(false);
  });

  it('swallows termination failures, matching the gRPC path', async () => {
    proxy.workflows.set('healthcheck-api-1', { workflowId: 'healthcheck-api-1', runId: 'run-1' });
    proxy.forcedFailure = { code: 13, message: 'boom', pathIncludes: '/terminate' };

    await expect(stopHealthCheckWorkflow('api-1')).resolves.toBeUndefined();
  });
});

describe('proxy contract: authentication and errors', () => {
  it('rejects a wrong token with the proxy plain-text 401', async () => {
    setConfig({ temporalAuthToken: 'wrong-token' });

    const err = await startWorkflowViaRest({
      workflowId: 'wf-1',
      workflowType: WORKFLOW_NAME,
      taskQueue: TASK_QUEUE,
    }).catch((caught) => caught as TemporalRestError);

    expect(err).toBeInstanceOf(TemporalRestError);
    expect(err.httpStatus).toBe(401);
    expect(err.message).toContain('unexpected response body');
    expect(err.message).toContain('Unauthorized');
  });

  it('fails fast with a clear message when the REST url or token is missing', async () => {
    setConfig({ temporalRestUrl: '' });
    await expect(
      startWorkflowViaRest({ workflowId: 'wf-1', workflowType: WORKFLOW_NAME, taskQueue: TASK_QUEUE }),
    ).rejects.toThrow(/TEMPORAL_REST_URL is required/);

    setConfig({ temporalAuthToken: '' });
    await expect(
      startWorkflowViaRest({ workflowId: 'wf-1', workflowType: WORKFLOW_NAME, taskQueue: TASK_QUEUE }),
    ).rejects.toThrow(/TEMPORAL_AUTH_TOKEN is required/);
  });

  it('exposes typed error details and never leaks the token', async () => {
    proxy.forcedFailure = { code: 16, message: `bearer token auth failed: ${TOKEN}` };

    const err = (await startWorkflowViaRest({
      workflowId: 'wf-1',
      workflowType: WORKFLOW_NAME,
      taskQueue: TASK_QUEUE,
    }).catch((caught) => caught)) as TemporalRestError;

    expect(err).toBeInstanceOf(Error);
    expect(err.operation).toBe('StartWorkflowExecution');
    expect(err.grpcCode).toBe(16);
    expect(err.message).toContain('[redacted]');
    expect(`${err.message}\n${err.stack}\n${JSON.stringify(err)}`).not.toContain(TOKEN);
  });

  it('reports an unreachable proxy without leaking the token', async () => {
    globalThis.fetch = (async (input: unknown) => {
      throw new Error(`getaddr failed for ${String(input)} with token ${TOKEN}`);
    }) as typeof fetch;

    const err = (await startWorkflowViaRest({
      workflowId: 'wf-1',
      workflowType: WORKFLOW_NAME,
      taskQueue: TASK_QUEUE,
    }).catch((caught) => caught)) as TemporalRestError;

    expect(err).toBeInstanceOf(TemporalRestError);
    expect(err.message).toMatch(/request to pulse-temporal-demo\.onrender\.com failed/);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('transport selection', () => {
  it('never opens a gRPC connection in REST mode', async () => {
    const connect = vi.spyOn(Connection, 'connect').mockRejectedValue(new Error('gRPC-connect-sentinel'));

    await startHealthCheckWorkflow('api-1', 'team-1', 60);
    await stopHealthCheckWorkflow('api-1');
    await startUptimeRollupWorkflow();

    expect(connect).not.toHaveBeenCalled();
    expect(proxy.requests.length).toBeGreaterThan(0);
  });

  it('still uses the SDK connection in gRPC mode', async () => {
    setConfig({ temporalTransport: 'grpc' });
    const connect = vi.spyOn(Connection, 'connect').mockRejectedValue(new Error('gRPC-connect-sentinel'));

    await expect(startHealthCheckWorkflow('api-1', 'team-1', 60)).rejects.toThrow('gRPC-connect-sentinel');
    expect(connect).toHaveBeenCalledWith({ address: 'localhost:7233', tls: false });
    expect(proxy.requests).toHaveLength(0);
  });

  it('keeps the worker on native gRPC regardless of TEMPORAL_TRANSPORT', () => {
    const workerSource = readFileSync(srcPath('../../src/temporal/worker.ts'), 'utf8');

    expect(workerSource).toContain('NativeConnection');
    expect(workerSource).toContain('Worker.create');
    // The worker is co-located with the Temporal server, so it must never be
    // routed through the REST proxy.
    expect(workerSource).not.toMatch(/temporalTransport|temporalRestUrl|restClient/);
  });

  it('gates the REST transport on the transport setting alone', () => {
    const lifecycleSource = readFileSync(srcPath('../../src/temporal/lifecycle.ts'), 'utf8');

    expect(lifecycleSource).toContain("config.temporalTransport === 'rest'");
    // The gRPC branch is still the SDK: connection + Client + handle.
    expect(lifecycleSource).toContain('Connection.connect');
    expect(lifecycleSource).toContain('new Client({ connection, namespace: config.temporalNamespace })');
    expect(lifecycleSource).toContain('client.workflow.getHandle(workflowId)');
  });
});
