export type Role = 'admin' | 'member';

export type IncidentStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED';

export type CheckStatus = 'UP' | 'DOWN' | 'DEGRADED';

export interface ApiConfig {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  expectedStatus: number;
  latencyThresholdMs: number;
  intervalSeconds: number;
  headers?: Record<string, string>;
  authToken?: string;
  body?: string;
  isActive: boolean;
  isPublic: boolean;
}
