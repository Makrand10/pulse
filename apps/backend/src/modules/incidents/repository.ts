import { Types } from 'mongoose';
import { Incident, type IncidentDoc } from '../../db/models/Incident';
import { CheckResult } from '../../db/models/CheckResult';
import type { CheckStatus, IncidentStatus, IncidentTimelineEventType } from '@pulse/shared-types';

export interface TimelineEventInput {
  type: IncidentTimelineEventType;
  message: string;
  actorId?: string;
}

// Build the subdocument payload exactly as the schema declares it
// (actorId is ObjectId in the model) so Mongoose stores a clean object.
function buildEvent(event: TimelineEventInput): {
  type: IncidentTimelineEventType;
  message: string;
  actorId?: Types.ObjectId;
  at: Date;
} {
  return {
    type: event.type,
    message: event.message,
    actorId: event.actorId ? new Types.ObjectId(event.actorId) : undefined,
    at: new Date(),
  };
}

function isValidId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}

export async function findOpenIncident(teamId: string, apiId: string): Promise<IncidentDoc | null> {
  return Incident.findOne({
    teamId,
    apiId,
    status: { $in: ['OPEN', 'INVESTIGATING'] },
  }).sort({ startedAt: -1 });
}

export async function createIncident(
  teamId: string,
  apiId: string,
  message: string,
  actorId?: string,
): Promise<IncidentDoc> {
  return Incident.create({
    teamId,
    apiId,
    status: 'OPEN',
    startedAt: new Date(),
    resolvedAt: null,
    timeline: [buildEvent({ type: 'OPENED', message, actorId })],
  });
}

export async function resolveIncident(
  teamId: string,
  incidentId: string,
  message: string,
  actorId?: string,
): Promise<IncidentDoc | null> {
  return Incident.findOneAndUpdate(
    { _id: incidentId, teamId, status: { $in: ['OPEN', 'INVESTIGATING'] } },
    {
      $set: { status: 'RESOLVED', resolvedAt: new Date() },
      $push: { timeline: buildEvent({ type: 'RESOLVED', message, actorId }) },
    },
    { returnDocument: 'after' },
  );
}

export async function transitionIncidentStatus(
  teamId: string,
  incidentId: string,
  status: Exclude<IncidentStatus, 'OPEN'>,
  message: string,
  actorId?: string,
): Promise<IncidentDoc | null> {
  const update: Record<string, unknown> = {
    $set: { status, ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : { resolvedAt: null }) },
    $push: { timeline: buildEvent({ type: status, message, actorId }) },
  };
  return Incident.findOneAndUpdate(
    { _id: incidentId, teamId },
    update,
    { returnDocument: 'after' },
  );
}

// Append-only: never $set the timeline wholesale, only ever $push new events.
export async function appendTimelineEvent(
  teamId: string,
  incidentId: string,
  event: TimelineEventInput,
): Promise<IncidentDoc | null> {
  return Incident.findOneAndUpdate(
    { _id: incidentId, teamId },
    { $push: { timeline: buildEvent(event) } },
    { returnDocument: 'after' },
  );
}

export async function getIncident(teamId: string, incidentId: string): Promise<IncidentDoc | null> {
  if (!isValidId(incidentId)) return null;
  return Incident.findOne({ _id: incidentId, teamId });
}

export interface IncidentAnalysisInput {
  aiSummary: string | null;
  aiSuggestedCause: string | null;
}

export async function persistIncidentAnalysis(
  teamId: string,
  incidentId: string,
  analysis: IncidentAnalysisInput,
): Promise<IncidentDoc | null> {
  if (!isValidId(incidentId)) return null;
  return Incident.findOneAndUpdate(
    { _id: incidentId, teamId },
    { $set: analysis },
    { returnDocument: 'after' },
  );
}

export async function listIncidents(
  teamId: string,
  status?: IncidentStatus,
  apiId?: string,
): Promise<IncidentDoc[]> {
  const filter: { teamId: string; status?: IncidentStatus; apiId?: string } = { teamId };
  if (status) filter.status = status;
  if (apiId) filter.apiId = apiId;
  return Incident.find(filter).sort({ startedAt: -1 });
}

// Most recent relevant check results, chronological (oldest → newest), so the
// state machine can compute the current trailing streak.
export async function getRecentCheckStatuses(
  teamId: string,
  apiId: string,
  limit: number,
): Promise<CheckStatus[]> {
  const docs = await CheckResult.find({ teamId, apiId }, { status: 1, _id: 0 })
    .sort({ checkedAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((d) => d.status as CheckStatus).reverse();
}