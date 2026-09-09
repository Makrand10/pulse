import type { IncidentDoc, IncidentTimelineEvent } from '../../db/models/Incident';
import type { IncidentStatus, IncidentTimelineEventType } from '@pulse/shared-types';

export interface IncidentTimelineEventDto {
  type: IncidentTimelineEventType;
  message: string;
  actorId?: string;
  at: string;
}

export interface IncidentDto {
  id: string;
  apiId: string;
  teamId: string;
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  aiSummary: string | null;
  aiSuggestedCause: string | null;
  timeline: IncidentTimelineEventDto[];
  createdAt: string;
  updatedAt: string;
}

interface TimelineRaw {
  type: IncidentTimelineEventType;
  message: string;
  actorId?: unknown;
  at: Date;
}

function toEventDto(event: IncidentTimelineEvent | TimelineRaw): IncidentTimelineEventDto {
  return {
    type: event.type,
    message: event.message,
    actorId: event.actorId ? String(event.actorId) : undefined,
    at: new Date(event.at).toISOString(),
  };
}

export function toIncidentDto(incident: IncidentDoc): IncidentDto {
  return {
    id: String(incident._id),
    apiId: String(incident.apiId),
    teamId: String(incident.teamId),
    status: incident.status,
    startedAt: new Date(incident.startedAt).toISOString(),
    resolvedAt: incident.resolvedAt ? new Date(incident.resolvedAt).toISOString() : null,
    aiSummary: incident.aiSummary ?? null,
    aiSuggestedCause: incident.aiSuggestedCause ?? null,
    timeline: (incident.timeline as unknown as TimelineRaw[]).map(toEventDto),
    createdAt: new Date(incident.createdAt ?? incident._id.getTimestamp()).toISOString(),
    updatedAt: incident.updatedAt ? new Date(incident.updatedAt).toISOString() : new Date(incident._id.getTimestamp()).toISOString(),
  };
}