import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const entrypoint = readFileSync(repoPath('../../../../infra/temporal-demo/entrypoint.sh'), 'utf8');
const dockerfile = readFileSync(repoPath('../../../../infra/temporal-demo/Dockerfile'), 'utf8');

// Temporal 1.25.2 builds its ring like this (common/membership/ringpop):
//   getListenIP()        -> net.Listen("tcp", <bindOnIP>:<membershipPort>)
//   broadcastAddress     -> the address this host advertises
//   startHeartbeat()     -> writes it to cluster_membership
//   bootstrapRingPop()   -> reads it back as ringpop's seed list
// A single node is only healthy when the bind address, the advertised address
// and the bootstrap entry are the same connectable address, so all three are
// pinned to loopback.
describe('temporal demo - single node membership is pinned to loopback', () => {
  it('pins BIND_ON_IP rather than defaulting it from the environment', () => {
    expect(entrypoint).toContain('SINGLE_NODE_BIND_IP=127.0.0.1');
    expect(entrypoint).toContain('export BIND_ON_IP="$SINGLE_NODE_BIND_IP"');

    // A `${BIND_ON_IP:-127.0.0.1}` default is exactly what regressed: the
    // platform environment overrides the image's ENV, and this service is
    // documented with BIND_ON_IP=0.0.0.0, so on Render the wildcard survived
    // the default and the node advertised an unreachable private IP.
    expect(entrypoint).not.toMatch(/BIND_ON_IP="\$\{BIND_ON_IP:-/);
  });

  it('pins the broadcast address to the same address the node binds', () => {
    expect(entrypoint).toContain('export TEMPORAL_BROADCAST_ADDRESS="$SINGLE_NODE_BIND_IP"');
  });

  it('no longer derives the broadcast address from the container hostname', () => {
    // Hostname derivation resolves to the ephemeral Render private IP that the
    // node then cannot reach, leaving "Current reachable members ... []".
    expect(entrypoint).not.toContain('getent hosts');
  });

  it('keeps gRPC on loopback and the public front door on Render PORT', () => {
    expect(entrypoint).toContain('export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}"');
    expect(dockerfile).toMatch(/ENV[\s\S]*?BIND_ON_IP=127\.0\.0\.1/);
    expect(dockerfile).toContain('TEMPORAL_ADDRESS=127.0.0.1:7233');
  });
});

// `entrypoint.sh --print-membership` resolves the settings and exits without
// starting anything, so the pinned values can be asserted end to end. It needs a
// real POSIX shell; CI runs on ubuntu, and on Windows `bash.exe` is the WSL
// launcher, which cannot resolve Windows paths, so the check is skipped there.
const bashAvailable = (() => {
  if (process.platform === 'win32') return false;
  const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  return probe.status === 0 && probe.stdout.trim() === 'ok';
})();

describe.runIf(bashAvailable)('entrypoint.sh --print-membership', () => {
  const resolveMembership = (env: Record<string, string>) => {
    const result = spawnSync(
      'bash',
      [repoPath('../../../../infra/temporal-demo/entrypoint.sh'), '--print-membership'],
      { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);

    const resolved: Record<string, string> = {};
    for (const line of result.stdout.split('\n')) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line);
      if (match) resolved[match[1]] = match[2];
    }
    return resolved;
  };

  it('ignores BIND_ON_IP=0.0.0.0, the value this service is documented with', () => {
    const resolved = resolveMembership({ BIND_ON_IP: '0.0.0.0' });
    expect(resolved.BIND_ON_IP).toBe('127.0.0.1');
    expect(resolved.TEMPORAL_BROADCAST_ADDRESS).toBe('127.0.0.1');
  });

  it('ignores a Render private IP in either variable', () => {
    const resolved = resolveMembership({
      BIND_ON_IP: '10.24.233.206',
      TEMPORAL_BROADCAST_ADDRESS: '10.24.233.206',
    });
    expect(resolved.BIND_ON_IP).toBe('127.0.0.1');
    expect(resolved.TEMPORAL_BROADCAST_ADDRESS).toBe('127.0.0.1');
  });

  it('falls back to loopback when nothing is set', () => {
    const resolved = resolveMembership({});
    expect(resolved.BIND_ON_IP).toBe('127.0.0.1');
    expect(resolved.TEMPORAL_BROADCAST_ADDRESS).toBe('127.0.0.1');
    expect(resolved.TEMPORAL_ADDRESS).toBe('127.0.0.1:7233');
  });

  it('still honours Render PORT and keeps the REST proxy on its own port', () => {
    const resolved = resolveMembership({ PORT: '8080' });
    expect(resolved.PORT).toBe('8080');
    expect(resolved.REST_PROXY_PORT).toBe('10000');
  });
});
