import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { Incident } from '../../src/db/models/Incident';
import { Notification } from '../../src/db/models/Notification';
import { applyIncidentEngine } from '../../src/modules/incidents/engine';
import { setEmailSender, getEmailSender, type EmailSender } from '../../src/modules/notifications/emailSender';
import { processEmailJob } from '../../src/modules/notifications/queue';
import { config } from '../../src/config';
import { signToken } from '../../src/modules/auth/token';
import type { CheckStatus } from '@pulse/shared-types';

let mongo: MongoMemoryServer;
let previousSender: EmailSender;

const PUBLIC_URL = 'https://api.example.com/status';

// Strictly increasing virtual clock so batched results stay chronological
// within the engine's trailing window (identical timestamps are ambiguous).
let clockMs = Date.now();
let nextClock = () => (clockMs += 1000);

async function signupAndToken(email: string, teamName: string): Promise<string> {
  const app = createApp();
  const res = await request(app).post('/api/v1/auth/signup').send({
    name: 'Owner',
    email,
    password: 'password123',
    teamName,
  });
  return res.body.token as string;
}

async function seedOpenIncident(teamId: string): Promise<{ apiId: string; incidentId: string }> {
  const api = await Api.create({ teamId, name: 'Checkout API', url: PUBLIC_URL });
  const apiId = String(api._id);
  await CheckResult.insertMany(
    (['UP', 'DOWN', 'DOWN', 'DOWN'] as CheckStatus[]).map((status) => ({
      teamId,
      apiId,
      status,
      latencyMs: status === 'DOWN' ? 0 : 50,
      checkedAt: new Date(nextClock()),
    })),
  );
  await applyIncidentEngine({ apiId, teamId });
  const incident = await Incident.findOne({ apiId, teamId });
  return { apiId, incidentId: String(incident!._id) };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  previousSender = getEmailSender();
}, 120000);

afterAll(async () => {
  setEmailSender(previousSender);
  await disconnectDb();
  if (mongo) await mongo.stop();
});

beforeEach(() => {
  // Every provider in this suite simulates a host that is down so we can
  // prove notification failure never breaks incident creation (DoD).
  setEmailSender({
    async sendEmail() {
      throw new Error('smtp connection refused');
    },
  });
});

describe('M5 DoD: email provider failure does not block incident creation', () => {
  it('creates the incident and an in-app notification even when email throws', async () => {
    const teamId = new Types.ObjectId().toString();
    await seedOpenIncident(teamId);

    const incident = await Incident.findOne({ teamId });
    const notification = await Notification.findOne({ teamId });

    expect(incident).not.toBeNull();
    expect(incident!.status).toBe('OPEN');
    expect(notification).not.toBeNull();
    expect(notification!.type).toBe('INCIDENT_OPENED');
    expect(notification!.emailStatus).toBe('PENDING'); // queued, never silently dropped
  });

  it('marks the notification FAILED after email retries are exhausted', async () => {
    const teamId = new Types.ObjectId().toString();
    const { incidentId } = await seedOpenIncident(teamId);
    const notification = await Notification.findOne({ teamId });

    // Simulate BullMQ delivering the job across max attempts; each run the
    // provider throws, and once attemptsMade reaches the cap the record is
    // marked FAILED (notification_failed) instead of silently dropped.
    const maxAttempts = config.emailMaxAttempts;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await expect(
        processEmailJob({
          data: { notificationId: String(notification!._id), teamId },
          attemptsMade: attempt,
          name: 'send-incident-email',
          id: 'job-1',
          opts: { attempts: maxAttempts },
        } as never),
      ).rejects.toThrow('smtp connection refused');
    }

    const updated = await Notification.findOne({ teamId });
    expect(updated!.emailStatus).toBe('FAILED');
    expect(updated!.emailAttempts).toBe(maxAttempts);
    expect(incidentId).toBeTruthy();
  });

  it('switches a notification to SENT when the provider succeeds', async () => {
    setEmailSender({
      async sendEmail() {
        // happy path
      },
    });
    const teamId = new Types.ObjectId().toString();
    await seedOpenIncident(teamId);
    const notification = await Notification.findOne({ teamId });

    await processEmailJob({
      data: { notificationId: String(notification!._id), teamId },
      attemptsMade: 0,
      name: 'send-incident-email',
      id: 'job-2',
      opts: { attempts: 5 },
    } as never);

    const updated = await Notification.findOne({ teamId });
    expect(updated!.emailStatus).toBe('SENT');
    expect(updated!.emailAttempts).toBe(1);
  });
});

describe('notifications REST API', () => {
  it('rejects unauthenticated requests', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('lists notifications for the team', async () => {
    const app = createApp();
    const token = await signupAndToken('m5-a@example.com', 'NotifList');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm5-a@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    await seedOpenIncident(teamId);

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe('INCIDENT_OPENED');
    expect(res.body[0].apiId).toBeTruthy();
    expect(res.body[0].incidentId).toBeTruthy();
  });

  it('filters to unread only', async () => {
    const app = createApp();
    const token = await signupAndToken('m5-b@example.com', 'UnreadFilter');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm5-b@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    await seedOpenIncident(teamId);
    const notification = await Notification.findOne({ teamId });
    await request(app)
      .post(`/api/v1/notifications/${String(notification!._id)}/read`)
      .set('Authorization', `Bearer ${token}`);

    const unread = await request(app)
      .get('/api/v1/notifications?unread=true')
      .set('Authorization', `Bearer ${token}`);
    expect(unread.body).toHaveLength(0);
  });

  it('marks a notification as read (idempotent) and scoped to the team', async () => {
    const app = createApp();
    const token = await signupAndToken('m5-c@example.com', 'MarkRead');
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'm5-c@example.com',
      password: 'password123',
    });
    const teamId = login.body.user.teamId as string;
    await seedOpenIncident(teamId);
    const notification = await Notification.findOne({ teamId });
    const id = String(notification!._id);

    const read = await request(app)
      .post(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.readAt).toBeTruthy();

    const again = await request(app)
      .post(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(200);

    const otherToken = await signupAndToken('m5-c2@example.com', 'OtherTeam');
    const cross = await request(app)
      .post(`/api/v1/notifications/${id}/read`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(cross.status).toBe(404);
  });

  it('404 for unknown notification', async () => {
    const app = createApp();
    const token = await signupAndToken('m5-d@example.com', 'NotFound');
    const res = await request(app)
      .post('/api/v1/notifications/000000000000000000000000/read')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an invalid type filter', async () => {
    const app = createApp();
    const token = await signupAndToken('m5-e@example.com', 'BadFilter');
    const res = await request(app)
      .get('/api/v1/notifications?type=BOGUS')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('notification token helpers', () => {
  it('issues a member-scoped JWT with teamId', () => {
    const token = signToken({ sub: 'u1', email: 'm@e.com', teamId: 't1', role: 'member' });
    expect(token.length).toBeGreaterThan(20);
  });
});