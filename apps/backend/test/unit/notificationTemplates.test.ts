import { describe, it, expect } from 'vitest';
import { buildEmail, buildNotificationMessage, buildIncidentLink } from '../../src/modules/notifications/templates';

describe('notification templates', () => {
  const base = {
    apiName: 'Checkout API',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    incidentLink: 'https://pulse.app/incidents/inc123',
  };

  it('builds an OPENED email with API name, start time, and incident link', () => {
    const { subject, html } = buildEmail('INCIDENT_OPENED', base);
    expect(subject).toContain('Incident opened');
    expect(subject).toContain('Checkout API');
    expect(html).toContain('Checkout API');
    expect(html).toContain('2026-01-01T00:00:00');
    expect(html).toContain('https://pulse.app/incidents/inc123');
  });

  it('builds a RESOLVED email with resolvedAt when provided', () => {
    const { subject, html } = buildEmail('INCIDENT_RESOLVED', {
      ...base,
      resolvedAt: new Date('2026-01-01T01:00:00Z'),
    });
    expect(subject).toContain('Incident resolved');
    expect(html).toContain('2026-01-01T01:00:00');
  });

  it('omits resolvedAt from OPENED emails', () => {
    const { html } = buildEmail('INCIDENT_OPENED', base);
    expect(html).not.toContain('Resolved:');
  });

  it('builds readable in-app messages', () => {
    expect(buildNotificationMessage('INCIDENT_OPENED', 'Checkout API')).toBe(
      'Incident opened for API "Checkout API"',
    );
    expect(buildNotificationMessage('INCIDENT_RESOLVED', 'Checkout API')).toBe(
      'Incident resolved for API "Checkout API"',
    );
  });

  it('builds an incident link from the base url', () => {
    expect(buildIncidentLink('abc123')).toMatch(/\/incidents\/abc123$/);
  });
});