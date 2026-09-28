'use strict';

const { spawn } = require('node:child_process');

// Runs the Pulse backend processes (API server, Temporal health-check worker,
// AI analysis worker, notifications worker) inside a single container.
// Children are respawned on failure; SIGTERM/SIGINT are forwarded so `docker
// compose down` exits cleanly.
//
// PULSE_PROCESSES (comma separated) narrows the set for hosts that only need
// some of them. The Render Free demo runs the Temporal worker inside the
// combined Temporal service instead, so the API service sets
// PULSE_PROCESSES=api,ai-worker,notifications. Unset => all four (local dev).
//
// TEMPORAL_TRANSPORT=rest additionally forces temporal-worker out, even if
// PULSE_PROCESSES asks for it. In that mode the backend talks to Temporal over
// HTTP via TEMPORAL_REST_URL and never needs a native gRPC client, so the
// in-container worker can only dial 127.0.0.1:7233 - a port the separate
// pulse-temporal-demo service owns - and would crash-loop on connection refused
// forever. The worker is still required for grpc mode and for local
// docker-compose, where the Temporal server shares the container's network.
const ALL_PROCESSES = [
  { name: 'api', entry: 'dist/server.js', port: 4000 },
  { name: 'temporal-worker', entry: 'dist/temporal/worker.js' },
  { name: 'ai-worker', entry: 'dist/modules/ai-analysis/worker.js' },
  { name: 'notifications', entry: 'dist/modules/notifications/worker.js' },
];

function selectProcesses(env = process.env) {
  const requested = (env.PULSE_PROCESSES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  let selected = requested.length
    ? ALL_PROCESSES.filter((proc) => requested.includes(proc.name))
    : ALL_PROCESSES;

  // Matches config.temporalTransport, which is the only way the app decides
  // between rest and grpc, so the entrypoint cannot disagree with the process
  // it is launching.
  if (env.TEMPORAL_TRANSPORT === 'rest') {
    selected = selected.filter((proc) => proc.name !== 'temporal-worker');
  }

  return selected;
}

const PROCESSES = selectProcesses();

const RESTART_BACKOFF_MS = 2000;
const children = new Map();

function startOne(proc, restarting) {
  if (children.has(proc.name)) return;
  const child = spawn(process.execPath, [proc.entry], {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.set(proc.name, { proc, child, restartTimer: null });

  child.on('exit', (code, signal) => {
    children.delete(proc.name);
    if (signal) {
      console.log(`[entrypoint] ${proc.name} stopped (${signal}); not restarting during shutdown`);
      if (children.size === 0) shutdown();
      return;
    }
    console.log(`[entrypoint] ${proc.name} exited (code ${code}) — restarting in ${RESTART_BACKOFF_MS}ms`);
    proc.exitTimer = setTimeout(() => startOne(proc, true), RESTART_BACKOFF_MS);
  });
  child.on('error', (err) => {
    console.error(`[entrypoint] failed to start ${proc.name}:`, err.message);
  });
  if (restarting) console.log(`[entrypoint] ${proc.name} respawned`);
  else console.log(`[entrypoint] started ${proc.name} (${proc.entry})`);
}

function shutdown() {
  console.log('[entrypoint] shutting down children');
  for (const { child } of children.values()) child.kill('SIGTERM');
  setTimeout(() => {
    for (const { child } of children.values()) child.kill('SIGKILL');
    process.exit(0);
  }, 5000).unref();
}

// Exported for tests. Requiring this file must not spawn anything, so the
// supervisor only runs when the entrypoint is the process being executed.
module.exports = { ALL_PROCESSES, selectProcesses };

if (require.main === module) {
  if (PROCESSES.length === 0) {
    console.error(
      `[entrypoint] PULSE_PROCESSES="${process.env.PULSE_PROCESSES}" matched none of: ${ALL_PROCESSES.map((p) => p.name).join(', ')}`,
    );
    process.exit(1);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  for (const proc of PROCESSES) startOne(proc);
}