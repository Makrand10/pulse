import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { ValidationErrorShape } from '../lib/errors';

const HOSTNAME_DENYLIST = new Set(['localhost', 'localhost.localdomain']);

function hostnameLooksBlocked(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (HOSTNAME_DENYLIST.has(lower)) return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.lan')) return true;
  return false;
}

export function isPublicIp(ip: string): boolean {
  const addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.range() !== 'unicast') return false;
    if (v6.toNormalizedString().toLowerCase().startsWith('2001:db8')) return false;
    return true;
  }
  const v4 = addr as ipaddr.IPv4;
  return v4.range() === 'unicast';
}

export function assertUrlProbeable(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationErrorShape('URL is malformed');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationErrorShape('Only http(s) URLs are allowed');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new ValidationErrorShape('URL must include a hostname');
  }

  if (hostnameLooksBlocked(hostname)) {
    throw new ValidationErrorShape('URL hostname is not publicly reachable');
  }

  if (ipaddr.isValid(hostname) && !isPublicIp(hostname)) {
    throw new ValidationErrorShape('URL resolves to a non-public IP address');
  }
}

export async function assertUrlPublicReachable(url: string): Promise<void> {
  assertUrlProbeable(url);

  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(hostname)) return;

  const records = await lookup(hostname, { all: true });
  for (const record of records) {
    if (!isPublicIp(record.address)) {
      throw new ValidationErrorShape(`URL resolves to a non-public IP address (${record.address})`);
    }
  }
}