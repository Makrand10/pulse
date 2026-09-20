import type { NotificationType } from '@pulse/shared-types';
import { createNotification } from './repository';
import { enqueueIncidentEmail } from './queue';
import { buildNotificationMessage } from './templates';

export interface NotifyIncidentEventInput {
  teamId: string;
  apiId: string;
  incidentId: string;
  type: NotificationType;
  apiName: string;
}

// Creates the in-app record (Mongo) and best-effort enqueues the email job.
// Never throws: incident state transitions are the source of truth and must not
// be blocked by notification infra (DoD).
export async function notifyIncidentEvent(input: NotifyIncidentEventInput): Promise<void> {
  const notification = await createNotification({
    teamId: input.teamId,
    apiId: input.apiId,
    incidentId: input.incidentId,
    type: input.type,
    message: buildNotificationMessage(input.type, input.apiName),
  });
  await enqueueIncidentEmail(String(notification._id), input.teamId);
}