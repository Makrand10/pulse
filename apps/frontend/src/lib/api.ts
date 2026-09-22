import type { UptimeStats, LatestCheck } from '@pulse/shared-types';

// When unset the app calls the API through the same origin (Next proxies
// /api/* to the backend); set this to a full URL to split frontend/backend
// on different hosts.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
export const TOKEN_KEY = 'pulse_token';
export const ACTIVE_TEAM_KEY = 'pulse_active_team_id';

export interface ApiDto {
  id: string;
  teamId: string;
  teamName?: string | null;
  name: string;
  slug: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  latencyThresholdMs: number;
  intervalSeconds: number;
  headers?: Record<string, string>;
  body?: string;
  hasAuthToken: boolean;
  isActive: boolean;
  isPublic: boolean;
  alertUserIds?: string[];
  currentStatus?: LatestCheck | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiDetailDto extends ApiDto {
  teamSlug: string | null;
  uptime: UptimeStats;
  currentStatus: LatestCheck | null;
}

export interface TeamMemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface PublicStatusDto {
  name: string;
  slug: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  status: LatestCheck | null;
  uptime: UptimeStats | null;
}

export interface CheckDto {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  latencyMs: number;
  statusCode?: number;
  errorMessage?: string;
  checkedAt: string;
}

export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';

export interface IncidentDto {
  id: string;
  apiId: string;
  teamId: string;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  aiSummary: string | null;
  aiSuggestedCause: string | null;
  timeline: { type: string; message: string; actorId?: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthSuccess {
  token: string;
  user: { id: string; name: string; email: string; role: string; teamId?: string | null };
  team?: { id: string; name: string; slug?: string | null };
}

export interface TeamDto {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

export interface DirectoryUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
}

export interface InvitationDto {
  teamId: string;
  teamName: string;
  teamSlug: string | null;
  role: string;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
  const activeTeamId =
    typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_TEAM_KEY) : null;
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeTeamId ? { 'x-team-id': activeTeamId } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep default message
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Unauthenticated: the public status page must work without a token, so it
// bypasses fetchJson's Authorization header and surfaces 404/429 as errors.
export async function fetchPublicStatus(
  teamSlug: string,
  apiSlug: string,
): Promise<PublicStatusDto> {
  const res = await fetch(
    `${API_URL}/public/status/${encodeURIComponent(teamSlug)}/${encodeURIComponent(apiSlug)}`,
  );
  if (!res.ok) {
    if (res.status === 404) throw new Error('This status page does not exist or is private.');
    if (res.status === 429) throw new Error('Too many requests — please try again shortly.');
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json() as Promise<PublicStatusDto>;
}