import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import type { NotificationType, NotificationEmailStatus } from '@pulse/shared-types';

const NOTIFICATION_TYPES: NotificationType[] = ['INCIDENT_OPENED', 'INCIDENT_RESOLVED'];
const EMAIL_STATUSES: NotificationEmailStatus[] = ['PENDING', 'SENT', 'FAILED'];

export const notificationSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    apiId: { type: Schema.Types.ObjectId, ref: 'Api', required: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    message: { type: String, required: true },
    emailStatus: { type: String, enum: EMAIL_STATUSES, required: true, default: 'PENDING' },
    emailAttempts: { type: Number, required: true, default: 0 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ teamId: 1, createdAt: -1 });

export type NotificationDoc = HydratedDocument<InferSchemaType<typeof notificationSchema>>;

export const Notification = model('Notification', notificationSchema);