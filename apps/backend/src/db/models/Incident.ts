import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { IncidentStatus, IncidentTimelineEventType } from '@pulse/shared-types';

const INCIDENT_STATUSES: IncidentStatus[] = ['OPEN', 'INVESTIGATING', 'RESOLVED'];
const TIMELINE_EVENT_TYPES: IncidentTimelineEventType[] = ['OPENED', 'INVESTIGATING', 'RESOLVED', 'COMMENT'];

export const incidentSchema = new Schema(
  {
    apiId: { type: Schema.Types.ObjectId, ref: 'Api', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    startedAt: { type: Date, required: true, default: () => new Date() },
    resolvedAt: { type: Date, default: null },
    status: { type: String, enum: INCIDENT_STATUSES, required: true, default: 'OPEN', index: true },
    aiSummary: { type: String, default: null },
    aiSuggestedCause: { type: String, default: null },
    timeline: [
      {
        type: { type: String, enum: TIMELINE_EVENT_TYPES, required: true },
        message: { type: String, required: true },
        actorId: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, required: true, default: () => new Date() },
      },
    ],
  },
  { timestamps: true },
);

incidentSchema.index({ teamId: 1, status: 1 });

export type IncidentDoc = HydratedDocument<InferSchemaType<typeof incidentSchema>>;

// Plain JSON-shaped event used for creation/append; never the Mongoose subdoc.
export interface IncidentTimelineEvent {
  type: IncidentTimelineEventType;
  message: string;
  actorId?: string;
  at: Date;
}

export const Incident = model('Incident', incidentSchema);