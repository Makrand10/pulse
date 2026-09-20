import type { UptimeStats, LatestCheck } from '@pulse/shared-types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const TOKEN_KEY = 'pulse_token';

export interface ApiDto {
  id: string;
  teamId: string;
  name: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface ApiDetailDto extends ApiDto {
  uptime: UptimeStats;
  currentStatus: LatestCheck | null;
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
  team?: { id: string; name: string };
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
  const headers: Record<string, string> = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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