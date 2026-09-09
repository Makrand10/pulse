import { z } from 'zod';

export type Role = 'admin' | 'member';

export const incidentStatusSchema = z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED']);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const incidentTimelineEventTypeSchema = z.enum(['OPENED', 'INVESTIGATING', 'RESOLVED', 'COMMENT']);
export type IncidentTimelineEventType = z.infer<typeof incidentTimelineEventTypeSchema>;

export const incidentCommentSchema = z.object({
  message: z.string().min(1).max(1000),
});

export const incidentStatusUpdateSchema = z.object({
  status: z.enum(['INVESTIGATING', 'RESOLVED']),
});

export type CheckStatus = 'UP' | 'DOWN' | 'DEGRADED';

export const apiMethodSchema = z.enum(['GET', 'POST', 'HEAD']);

export const apiCreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(2048),
  method: apiMethodSchema.default('GET'),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  latencyThresholdMs: z.number().int().positive().default(1000),
  intervalSeconds: z.number().int().min(30).max(86400).default(60),
  headers: z.record(z.string(), z.string()).optional(),
  authToken: z.string().max(4000).optional(),
  body: z.string().max(65536).optional(),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(false),
});

export const apiUpdateSchema = apiCreateSchema.partial();

export type ApiCreateInput = z.infer<typeof apiCreateSchema>;
export type ApiUpdateInput = z.infer<typeof apiUpdateSchema>;

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