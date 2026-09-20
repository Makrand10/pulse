import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { getApiForWorker } from '../healthchecks/repository';
import { getIncident } from '../incidents/repository';
import { getNotification, listTeamMemberEmails, updateEmailStatus } from './repository';
import { getEmailSender } from './emailSender';
import { buildEmail, buildIncidentLink } from './templates';

const JOB_NAME = 'send-incident-email';

let queue: Queue | null = null;

// Fast-fail when Redis is absent (tests/local) so enqueue never hangs and
// never blocks incident creation. Production Redis is always reachable.
function redisConnection() {
  return {
    url: config.redisUrl,
    connectTimeout: 2000,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      if (times >= 3) return null;
      return 100;
    },
  };
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(config.notifyQueueName, { connection: redisConnection() });
    // Redis/email infra is optional on the incident path: enqueue failures are
    // caught in enqueueIncidentEmail and logged as a warn, so the connection
    // 'error' event (e.g. no local Redis) just needs a listener to stay silent.
    queue.on('error', () => undefined);
  }
  return queue;
}

// Best-effort enqueue. Incident creation must NEVER block on email infra
// (DoD): if Redis is down the record stays PENDING and is retried on the
// worker later; a failed enqueue only logs, never throws.
export async function enqueueIncidentEmail(notificationId: string, teamId: string): Promise<void> {
  try {
    await getQueue().add(
      JOB_NAME,
      { notificationId, teamId },
      {
        attempts: config.emailMaxAttempts,
        backoff: { type: 'exponential', delay: config.emailBackoffMs },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'notification enqueue failed; email will not send');
  }
}

export interface EmailJobData {
  notificationId: string;
  teamId: string;
}

// Single-email processor. On failure increments attempts and re-throws so
// BullMQ backs off and retries; once max attempts are exhausted the record is
// marked FAILED (notification_failed) — never silently dropped.
export async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { notificationId, teamId } = job.data;

  const notification = await getNotification(teamId, notificationId);
  if (!notification || notification.emailStatus === 'SENT') return;

  const incident = await getIncident(teamId, String(notification.incidentId));
  const apiName = incident ? (await getApiForWorker(String(incident.apiId)))?.name ?? 'Unknown API' : 'Unknown API';

  const attempts = (job.attemptsMade ?? 0) + 1;
  const to = await listTeamMemberEmails(teamId);
  const { subject, html } = buildEmail(notification.type, {
    apiName,
    startedAt: incident?.startedAt ?? new Date(),
    resolvedAt: notification.type === 'INCIDENT_RESOLVED' ? incident?.resolvedAt ?? null : null,
    incidentLink: buildIncidentLink(String(notification.incidentId)),
  });

  try {
    await getEmailSender().sendEmail({ to, subject, html });
    await updateEmailStatus(teamId, notificationId, 'SENT', attempts);
  } catch (err) {
    await updateEmailStatus(teamId, notificationId, 'PENDING', attempts);
    if (attempts >= config.emailMaxAttempts) {
      await updateEmailStatus(teamId, notificationId, 'FAILED', attempts);
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), notificationId },
        'notification_failed: email send exhausted retries',
      );
    }
    throw err;
  }
}

export async function startNotificationWorker(): Promise<Worker<EmailJobData>> {
  const worker = new Worker<EmailJobData>(
    config.notifyQueueName,
    processEmailJob,
    { connection: redisConnection() },
  );
  await worker.waitUntilReady();
  return worker;
}