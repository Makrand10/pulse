import type { LatestCheck, UptimeStats } from '@pulse/shared-types';

// Explicit allowlist for the public status endpoint. Never spread the Mongo
// document (PRD §6 / M8 DoD): only non-sensitive, presentation-ready fields
// leave this mapper. teamId, headers, auth flags, alert rules, etc. are all
// absent by construction.
export interface PublicStatusDto {
  name: string;
  slug: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  status: LatestCheck | null;
  uptime: UptimeStats | null;
}

export interface ToPublicDtoInput {
  name: string;
  slug: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  currentStatus: LatestCheck | null;
  uptime: UptimeStats;
}

export function toPublicDTO(input: ToPublicDtoInput): PublicStatusDto {
  return {
    name: input.name,
    slug: input.slug,
    url: input.url,
    method: input.method,
    expectedStatus: input.expectedStatus,
    status: input.currentStatus,
    uptime: input.uptime,
  };
}