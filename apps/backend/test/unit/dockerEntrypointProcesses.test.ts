import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ALL_PROCESSES, selectProcesses } = require('../../docker-entrypoint.js');

const names = (env: Record<string, string>) => selectProcesses(env).map((p: { name: string }) => p.name);

describe('docker-entrypoint process selection', () => {
  it('runs all four processes when nothing is configured', () => {
    expect(names({})).toEqual(['api', 'temporal-worker', 'ai-worker', 'notifications']);
  });

  it('keeps the temporal worker in grpc mode', () => {
    // Local dev and docker-compose: the Temporal server shares the container's
    // network, so the worker must still start and dial 127.0.0.1:7233.
    expect(names({ TEMPORAL_TRANSPORT: 'grpc' })).toContain('temporal-worker');
    expect(names({ PULSE_PROCESSES: 'api,temporal-worker', TEMPORAL_TRANSPORT: 'grpc' })).toEqual([
      'api',
      'temporal-worker',
    ]);
  });

  it('excludes the temporal worker whenever transport is rest, even if requested', () => {
    // The reported Render failure: PULSE_PROCESSES listed it, but the worker
    // crash-looped on 127.0.0.1:7233 because Temporal lives in another service.
    expect(names({ TEMPORAL_TRANSPORT: 'rest', PULSE_PROCESSES: 'api,ai-worker,notifications' })).toEqual([
      'api',
      'ai-worker',
      'notifications',
    ]);
    expect(names({ TEMPORAL_TRANSPORT: 'rest', PULSE_PROCESSES: 'api,temporal-worker,notifications' })).toEqual([
      'api',
      'notifications',
    ]);
    // Unset PULSE_PROCESSES defaults to all four; rest still removes the worker.
    expect(names({ TEMPORAL_TRANSPORT: 'rest' })).toEqual(['api', 'ai-worker', 'notifications']);
  });

  it('only treats an exact "rest" as rest, matching config.temporalTransport', () => {
    // config/index.ts maps anything other than 'rest' to grpc, so the entrypoint
    // must not strip the worker for a near-miss value.
    expect(names({ TEMPORAL_TRANSPORT: 'REST' })).toContain('temporal-worker');
    expect(names({ TEMPORAL_TRANSPORT: 'rest-ish' })).toContain('temporal-worker');
  });

  it('preserves order and other PULSE_PROCESSES behaviour', () => {
    expect(names({ PULSE_PROCESSES: 'notifications,api' })).toEqual(['api', 'notifications']);
    expect(names({ PULSE_PROCESSES: ' api , notifications ' })).toEqual(['api', 'notifications']);
    expect(names({ PULSE_PROCESSES: '' })).toHaveLength(ALL_PROCESSES.length);
  });

  it('still yields nothing when the request matches no known process', () => {
    expect(names({ PULSE_PROCESSES: 'nope' })).toEqual([]);
    // A rest-only request is reduced to nothing, which the entrypoint treats as
    // a configuration error rather than silently starting zero processes.
    expect(names({ PULSE_PROCESSES: 'temporal-worker', TEMPORAL_TRANSPORT: 'rest' })).toEqual([]);
  });

  it('spawns nothing merely by being required', () => {
    // Guards the require.main guard: importing this file in a test must not
    // start the API server or any worker.
    expect(ALL_PROCESSES.map((p: { entry: string }) => p.entry)).toEqual([
      'dist/server.js',
      'dist/temporal/worker.js',
      'dist/modules/ai-analysis/worker.js',
      'dist/modules/notifications/worker.js',
    ]);
  });
});
