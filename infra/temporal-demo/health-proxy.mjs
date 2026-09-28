// HTTP front door for the combined Temporal demo service.
//
// Render only ever talks to $PORT over plain HTTP and sends health checks with
// no custom headers, but the official REST-to-gRPC proxy requires a Bearer
// token on *every* request. So this wrapper:
//
//   - answers GET /healthz and GET /readyz itself, without auth, reporting
//     whether Temporal's gRPC port is actually accepting connections
//   - forwards every other request to the proxy verbatim (method, path, query,
//     headers including Authorization, body)
//
// The proxy's own API contract is untouched: this is a pass-through, not a
// re-implementation. Nothing about the request headers is ever logged.
import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PORT || 8080);
const UPSTREAM_HOST = process.env.REST_PROXY_HOST || '127.0.0.1';
// The official proxy binary listens on a fixed :10000 (see rest-proxy/main.go).
const UPSTREAM_PORT = Number(process.env.REST_PROXY_PORT || 10000);
const TEMPORAL_HOST = process.env.TEMPORAL_GRPC_HOST || '127.0.0.1';
const TEMPORAL_PORT = Number(process.env.TEMPORAL_GRPC_PORT || 7233);
const UPSTREAM_TIMEOUT_MS = Number(process.env.REST_PROXY_TIMEOUT_MS || 15000);
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Hop-by-hop headers must not be forwarded in either direction.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function log(message) {
  console.log(`[health-proxy] ${message}`);
}

function temporalReachable() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: TEMPORAL_HOST, port: TEMPORAL_PORT });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function handleHealth(req, res) {
  const reachable = await temporalReachable();
  res.writeHead(reachable ? 200 : 503, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      status: reachable ? 'ok' : 'degraded',
      temporal: reachable ? 'reachable' : 'unreachable',
    }),
  );
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && (path === '/healthz' || path === '/readyz')) {
    handleHealth(req, res).catch(() => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error' }));
    });
    return;
  }

  forward(req, res, path).catch(() => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'rest proxy unreachable' }));
  });
});

async function forward(req, res, path) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'payload too large' }));
      return;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && typeof value === 'string') {
      headers[name] = value;
    }
  }
  if (body.length > 0) headers['content-length'] = String(body.length);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`http://${UPSTREAM_HOST}:${UPSTREAM_PORT}${req.url}`, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
      signal: controller.signal,
    });

    const responseHeaders = {};
    upstream.headers.forEach((value, name) => {
      // fetch already decoded the body, so drop stale framing headers.
      if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'content-encoding') {
        responseHeaders[name] = value;
      }
    });

    res.writeHead(upstream.status, responseHeaders);
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } finally {
    clearTimeout(timer);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  log(`listening on 0.0.0.0:${PORT}, proxying /api/* to ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
