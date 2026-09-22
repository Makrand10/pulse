// Runs the four Pulse backend processes (API server, Temporal health-check
// worker, AI analysis worker, notifications worker) inside a single container.
// Children are respawned on failure; SIGTERM/SIGINT are forwarded so `docker
// compose down` exits cleanly.
'use strict';

const { spawn } = require('node:child_process');

const PROCESSES = [
  { name: 'api', entry: 'dist/server.js', port: 4000 },
  { name: 'temporal-worker', entry: 'dist/temporal/worker.js' },
  { name: 'ai-worker', entry: 'dist/modules/ai-analysis/worker.js' },
  { name: 'notifications', entry: 'dist/modules/notifications/worker.js' },
];

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

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

for (const proc of PROCESSES) startOne(proc);