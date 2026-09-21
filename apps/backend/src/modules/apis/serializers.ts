import type { ApiDoc } from '../../db/models/Api';
import type { ApiConfig } from '@pulse/shared-types';

export interface ApiDto {
  id: string;
  teamId: string;
  slug: string;
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
  alertUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function toApiDto(api: ApiDoc): ApiDto {
  const headers: Record<string, string> = {};
  if (api.headers) {
    for (const [k, v] of api.headers.entries()) headers[k] = v;
  }
  const config: ApiConfig = {
    name: api.name,
    url: api.url,
    method: api.method,
    expectedStatus: api.expectedStatus,
    latencyThresholdMs: api.latencyThresholdMs,
    intervalSeconds: api.intervalSeconds,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: api.body ?? undefined,
    isActive: api.isActive,
    isPublic: api.isPublic,
  };
  return {
    id: String(api._id),
    teamId: String(api.teamId),
    slug: api.slug ?? '',
    name: config.name,
    url: config.url,
    method: config.method,
    expectedStatus: config.expectedStatus,
    latencyThresholdMs: config.latencyThresholdMs,
    intervalSeconds: config.intervalSeconds,
    headers: config.headers,
    body: config.body,
    hasAuthToken: Boolean(api.authTokenEncrypted),
    isActive: api.isActive,
    isPublic: api.isPublic,
    alertUserIds: (api.alertUserIds ?? []).map(String),
    createdAt: api.createdAt?.toISOString() ?? '',
    updatedAt: api.updatedAt?.toISOString() ?? '',
  };
}