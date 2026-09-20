import type { NotificationType } from '@pulse/shared-types';
import { config } from '../../config';

export interface NotificationTemplateData {
  apiName: string;
  startedAt: Date;
  resolvedAt?: Date | null;
  incidentLink: string;
}

export function buildNotificationMessage(type: NotificationType, apiName: string): string {
  return type === 'INCIDENT_OPENED'
    ? `Incident opened for API "${apiName}"`
    : `Incident resolved for API "${apiName}"`;
}

export function buildEmail(
  type: NotificationType,
  data: NotificationTemplateData,
): { subject: string; html: string } {
  const isOpened = type === 'INCIDENT_OPENED';
  const started = data.startedAt.toISOString();
  const source = isOpened ? 'Incident opened' : 'Incident resolved';
  const body = isOpened
    ? `Your API <strong>${data.apiName}</strong> is experiencing consecutive check failures. An incident has been opened.`
    : `Your API <strong>${data.apiName}</strong> is healthy again. The incident has been resolved.`;

  const details = `<li>API: ${data.apiName}</li><li>Opened: ${started}</li>${
    data.resolvedAt ? `<li>Resolved: ${data.resolvedAt.toISOString()}</li>` : ''
  }`;

  return {
    subject: `[Pulse] ${source}: ${data.apiName}`,
    html: `
      <h2>${source}</h2>
      <p>${body}</p>
      <ul>${details}</ul>
      <p><a href="${data.incidentLink}">View incident</a></p>
      <p style="color:#888;font-size:12px">— Pulse monitoring</p>
    `,
  };
}

export function buildIncidentLink(incidentId: string): string {
  return `${config.appBaseUrl}/incidents/${incidentId}`;
}