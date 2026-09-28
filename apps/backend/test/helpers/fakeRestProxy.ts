// A stand-in for render-examples/temporal-rest-proxy that reproduces the parts
// of its behaviour the REST client depends on, so tests assert against the real
// contract instead of against our own assumptions.
//
// Mirrored from the upstream sources:
//   - routes: the `google.api.http` annotations in
//     proto/api/temporal/api/workflowservice/v1/service.proto
//   - `ListWorkflowExecutionsRequest` has only namespace, page_size,
//     next_page_token and query, so only `query` + `pageSize` can filter
//   - grpc-gateway v1.16 runtime/query.go: an unknown query parameter is
//     SILENTLY DROPPED (fieldByProtoName -> `return nil`), never a 400
//   - grpc-gateway v1.16 runtime/errors.go: gRPC code -> HTTP status, so both
//     AlreadyExists (6) and Aborted (10) arrive as 409
//   - errors are marshalled as {error, code, message, details}
//   - rest-proxy/main.go: `Authorization: Bearer <AUTH_TOKEN>` with an exact
//     match, and a plain-text 401 (Go's http.Error) when it does not match
//   - one payload per workflow argument; metadata.encoding is base64 of
//     "json/plain"

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

export interface FakeWorkflow {
  workflowId: string;
  runId: string;
  args?: unknown[];
  cronSchedule?: string;
  terminated?: boolean;
  terminateReason?: string;
}

export interface ForcedFailure {
  /** gRPC status code, e.g. 6 = AlreadyExists, 10 = Aborted, 13 = Internal. */
  code: number;
  message: string;
  /** Only fail requests whose method+path contains this, when omitted fail all. */
  pathIncludes?: string;
}

interface DecodedPayload {
  encoding: string;
  data: unknown;
}

/** grpc-gateway v1.16 runtime.HTTPStatusFromCode. */
export function grpcCodeToHttpStatus(code: number): number {
  switch (code) {
    case 0:
      return 200;
    case 1:
      return 499;
    case 3:
      return 400;
    case 4:
      return 504;
    case 5:
      return 404;
    case 6:
      return 409; // AlreadyExists
    case 7:
      return 403;
    case 9:
      return 400;
    case 10:
      return 409; // Aborted - same status as AlreadyExists
    case 11:
      return 400;
    case 12:
      return 501;
    case 13:
      return 500;
    case 14:
      return 503;
    case 16:
      return 401;
    default:
      return 500;
  }
}

/** Decode `input.payloads` into the positional arguments Temporal would pass. */
export function decodePayloads(body: Record<string, unknown> | undefined): DecodedPayload[] {
  const input = body?.input as { payloads?: { data?: string; metadata?: Record<string, string> }[] } | undefined;
  if (!input?.payloads) return [];
  return input.payloads.map((payload) => ({
    encoding: Buffer.from(payload.metadata?.encoding ?? '', 'base64').toString('utf8'),
    data: JSON.parse(Buffer.from(payload.data ?? '', 'base64').toString('utf8')),
  }));
}

/** Parse `WorkflowId = 'x'` out of a visibility query string. */
export function extractWorkflowIdFilter(query: string | undefined): string | undefined {
  const match = /WorkflowId\s*=\s*'((?:[^']|'')*)'/.exec(query ?? '');
  return match ? match[1].replace(/''/g, "'") : undefined;
}

const NAMESPACE = 'default';

export class FakeRestProxy {
  readonly requests: RecordedRequest[] = [];

  /** Query parameters the client sent that this proxy cannot honour. */
  readonly ignoredQueryParams: string[] = [];

  workflows = new Map<string, FakeWorkflow>();
  forcedFailure?: ForcedFailure;
  private runCounter = 0;

  constructor(readonly authToken: string) {}

  private nextRunId(): string {
    this.runCounter += 1;
    return `run-${this.runCounter}`;
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  private grpcError(code: number, message: string): Response {
    // runtimeError, as marshalled by the gateway's JSONPb marshaler.
    return this.json(grpcCodeToHttpStatus(code), { error: message, code, message, details: [] });
  }

  private handle = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;

    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const request: RecordedRequest = { method, path: url.pathname, query, headers, body };
    this.requests.push(request);

    // rest-proxy/main.go: exact bearer token match, plain-text 401 otherwise.
    const auth = headers.Authorization ?? '';
    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || token !== this.authToken) {
      return new Response('Unauthorized\n', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (this.forcedFailure && (!this.forcedFailure.pathIncludes || url.pathname.includes(this.forcedFailure.pathIncludes))) {
      const { code, message } = this.forcedFailure;
      this.forcedFailure = undefined;
      return this.grpcError(code, message);
    }

    if (!url.pathname.includes(`/namespaces/${NAMESPACE}/workflows`)) {
      return this.json(404, { code: 5, message: 'not found' });
    }

    // POST /api/v1/namespaces/{namespace}/workflows/{workflow_id}/start
    const startMatch = /\/namespaces\/[^/]+\/workflows\/([^/]+)\/start$/.exec(url.pathname);
    if (method === 'POST' && startMatch) {
      const workflowId = decodeURIComponent(startMatch[1]);
      if (this.workflows.has(workflowId)) {
        return this.grpcError(6, 'workflow execution already started');
      }
      const runId = this.nextRunId();
      this.workflows.set(workflowId, {
        workflowId,
        runId,
        args: decodePayloads(body).map((payload) => payload.data),
        cronSchedule: body?.cronSchedule as string | undefined,
      });
      return this.json(200, { runId });
    }

    // GET /api/v1/namespaces/{namespace}/workflows/open
    if (method === 'GET' && url.pathname.endsWith('/workflows/open')) {
      // Only `query` and `pageSize` exist on ListWorkflowExecutionsRequest.
      // Anything else is dropped without an error, exactly like the gateway.
      for (const key of Object.keys(query)) {
        if (key !== 'query' && key !== 'pageSize' && key !== 'nextPageToken') {
          this.ignoredQueryParams.push(key);
        }
      }
      const wantedId = extractWorkflowIdFilter(query.query);
      let matches = [...this.workflows.values()].filter((wf) => !wf.terminated);
      if (query.query && wantedId === undefined) {
        return this.grpcError(3, 'unsupported query');
      }
      if (wantedId !== undefined) matches = matches.filter((wf) => wf.workflowId === wantedId);

      const pageSize = query.pageSize ? Number(query.pageSize) : matches.length;
      const page = matches.slice(0, Number.isFinite(pageSize) ? pageSize : matches.length);
      return this.json(200, {
        executions: page.map((wf) => ({
          execution: { workflowId: wf.workflowId, runId: wf.runId },
          type: { name: 'healthCheckWorkflow' },
          status: 1,
          historyLength: '10',
        })),
        nextPageToken: '',
      });
    }

    // POST .../workflows/{workflow_execution.workflow_id}/executions/{workflow_execution.run_id}/terminate
    const terminateMatch = /\/workflows\/([^/]+)\/executions\/([^/]+)\/terminate$/.exec(url.pathname);
    if (method === 'POST' && terminateMatch) {
      const workflowId = decodeURIComponent(terminateMatch[1]);
      const runId = decodeURIComponent(terminateMatch[2]);
      const workflow = this.workflows.get(workflowId);
      if (!workflow || workflow.runId !== runId) {
        return this.grpcError(5, 'workflow execution not found');
      }
      workflow.terminated = true;
      workflow.terminateReason = body?.reason as string;
      return this.json(200, {});
    }

    return this.json(404, { code: 5, message: 'not found' });
  };

  install(): void {
    globalThis.fetch = this.handle as unknown as typeof fetch;
  }

  static restore(realFetch: typeof fetch): void {
    globalThis.fetch = realFetch;
  }
}
