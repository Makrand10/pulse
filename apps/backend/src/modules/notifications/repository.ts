import { Notification, type NotificationDoc } from '../../db/models/Notification';
import { User } from '../../db/models/User';
import type { NotificationType, NotificationEmailStatus } from '@pulse/shared-types';

export interface CreateNotificationInput {
  teamId: string;
  apiId: string;
  incidentId: string;
  type: NotificationType;
  message: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationDoc> {
  return Notification.create({ ...input, emailStatus: 'PENDING', emailAttempts: 0 });
}

export async function getNotification(teamId: string, notificationId: string): Promise<NotificationDoc | null> {
  return Notification.findOne({ _id: notificationId, teamId });
}

export async function listNotifications(
  teamId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationDoc[]> {
  const filter: Record<string, unknown> = { teamId };
  if (opts.unreadOnly) filter.readAt = null;
  return Notification.find(filter).sort({ createdAt: -1 }).limit(opts.limit ?? 50);
}

// Append-only update: only ever flips email/bookkeeping fields, never message contents.
export async function markNotificationRead(teamId: string, notificationId: string): Promise<NotificationDoc | null> {
  return Notification.findOneAndUpdate(
    { _id: notificationId, teamId, readAt: null },
    { $set: { readAt: new Date() } },
    { returnDocument: 'after' },
  );
}

export async function updateEmailStatus(
  teamId: string,
  notificationId: string,
  status: NotificationEmailStatus,
  attempts: number,
): Promise<void> {
  await Notification.updateOne(
    { _id: notificationId, teamId },
    { $set: { emailStatus: status, emailAttempts: attempts } },
  );
}

// Recipients are every team member's inbox, unless the API's alert rules pin a
// subset (alertUserIds). The worker resolves the API and passes its rules so
// "who gets notified per API" is honored end-to-end (M8).
export async function listTeamMemberEmails(teamId: string, alertUserIds?: string[]): Promise<string[]> {
  const filter: Record<string, unknown> = { teamId };
  if (alertUserIds && alertUserIds.length > 0) {
    filter._id = { $in: alertUserIds };
  }
  const users = await User.find(filter, { email: 1, _id: 0 }).lean();
  return users.map((u) => u.email);
}