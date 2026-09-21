import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Api } from '../../src/db/models/Api';
import { CheckResult } from '../../src/db/models/CheckResult';
import { Notification } from '../../src/db/models/Notification';
import { createUser, attachUserToTeam } from '../../src/modules/teams/repository';
import { listTeamMemberEmails } from '../../src/modules/notifications/repository';
import { applyIncidentEngine } from '../../src/modules/incidents/engine';
import { setEmailSender, getEmailSender, type EmailSender, type SendEmailInput } from '../../src/modules/notifications/emailSender';
import { processEmailJob } from '../../src/modules/notifications/queue';
import type { CheckStatus } from '@pulse/shared-types';

let mongo: MongoMemoryServer;
let previousSender: EmailSender;

let clockMs = Date.now();
const nextClock = () => (clockMs += 1000);

async function signupOwner(email: string, teamName: string): Promise<{ token: string; teamId: string }> {
  const app = createApp();
  const signup = await request(app).post('/api/v1/auth/signup').send({
    name: 'Owner',
    email,
    password: 'password123',
    teamName,
  });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
  return { token: signup.body.token as string, teamId: login.body.user.teamId as string };
}

async function seedIncident(teamId: string, apiId: string): Promise<void> {
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

describe('M8: alert rules — who gets notified per API', () => {
  it('lists the team roster and persists a per-API recipient subset', async () => {
    const app = createApp();
    const { token, teamId } = await signupOwner('m8-alerts@example.com', 'Alerts Team');
    const member = await createUser({ name: 'Member', email: 'm8-member@example.com', passwordHash: 'x' });
    const memberId = String(member._id);
    await attachUserToTeam(memberId, teamId, 'member');

    const members = await request(app)
      .get('/api/v1/teams/members')
      .set('Authorization', `Bearer ${token}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(2);
    expect(members.body.map((m: { email: string }) => m.email).sort()).toEqual([
      'm8-alerts@example.com',
      'm8-member@example.com',
    ]);

    const api = await Api.create({ teamId, name: 'Alerts API', slug: 'alerts-api', url: 'https://a.example' });
    const patched = await request(app)
      .patch(`/api/v1/apis/${String(api._id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ alertUserIds: [memberId] });

    expect(patched.status).toBe(200);
    expect(patched.body.alertUserIds).toEqual([memberId]);
  });

  it('rejects recipient ids that are not team members', async () => {
    const app = createApp();
    const { token, teamId } = await signupOwner('m8-badids@example.com', 'BadIds Team');
    const api = await Api.create({ teamId, name: 'BadIds API', slug: 'badids-api', url: 'https://b.example' });

    const res = await request(app)
      .patch(`/api/v1/apis/${String(api._id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ alertUserIds: [new Types.ObjectId().toString()] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('routes email only to the configured subset, and to everyone when unset', async () => {
    const { teamId } = await signupOwner('m8-owner@example.com', 'Routing Team');
    const member = await createUser({ name: 'Member', email: 'm8-oncall@example.com', passwordHash: 'x' });
    const memberId = String(member._id);
    await attachUserToTeam(memberId, teamId, 'member');

    // Configurable recipients on the API drive the worker.
    const targetedApi = await Api.create({
      teamId,
      name: 'Targeted API',
      slug: 'targeted',
      url: 'https://c.example',
      alertUserIds: [memberId],
    });
    await seedIncident(teamId, String(targetedApi._id));
    const targetedNotification = await Notification.findOne({ teamId, apiId: targetedApi._id });

    let captured: SendEmailInput | null = null;
    setEmailSender({
      async sendEmail(input: SendEmailInput) {
        captured = input;
      },
    });
    await processEmailJob({
      data: { notificationId: String(targetedNotification!._id), teamId },
      attemptsMade: 0,
      name: 'send-incident-email',
      id: 'alert-1',
      opts: { attempts: 5 },
    } as never);
    expect(captured!.to).toEqual(['m8-oncall@example.com']);

    // Unset rules → whole team.
    const allApi = await Api.create({ teamId, name: 'All API', slug: 'all', url: 'https://d.example' });
    await seedIncident(teamId, String(allApi._id));
    const allNotification = await Notification.findOne({ teamId, apiId: allApi._id });
    captured = null;
    await processEmailJob({
      data: { notificationId: String(allNotification!._id), teamId },
      attemptsMade: 0,
      name: 'send-incident-email',
      id: 'alert-2',
      opts: { attempts: 5 },
    } as never);
    expect(captured!.to.sort()).toEqual(['m8-oncall@example.com', 'm8-owner@example.com']);

    // Repository-level contract.
    expect(await listTeamMemberEmails(teamId)).toHaveLength(2);
    expect(await listTeamMemberEmails(teamId, [memberId])).toEqual(['m8-oncall@example.com']);
  });
});