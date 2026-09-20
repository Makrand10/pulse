import type { NotificationDoc } from '../../db/models/Notification';
import type { NotificationType, NotificationEmailStatus } from '@pulse/shared-types';

export interface NotificationDto {
  id: string;
  teamId: string;
  apiId: string;
  incidentId: string;
  type: NotificationType;
  message: string;
  emailStatus: NotificationEmailStatus;
  emailAttempts: number;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toNotificationDto(notification: NotificationDoc): NotificationDto {
  return {
    id: String(notification._id),
    teamId: String(notification.teamId),
    apiId: String(notification.apiId),
    incidentId: String(notification.incidentId),
    type: notification.type,
    message: notification.message,
    emailStatus: notification.emailStatus,
    emailAttempts: notification.emailAttempts,
    readAt: notification.readAt ? new Date(notification.readAt).toISOString() : null,
    createdAt: new Date(notification.createdAt ?? new Date()).toISOString(),
    updatedAt: new Date(notification.updatedAt ?? new Date()).toISOString(),
  };
}