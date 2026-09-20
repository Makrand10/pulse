import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { runAnalysis } from './graph';
import { persistIncidentAnalysis } from '../incidents/repository';
import { canAttemptClaude, recordClaudeSuccess, recordClaudeFailure } from './breaker';
import { canSpendAiCall, recordAiCall } from './budget';

const JOB_NAME = 'ai-incident-analysis';

let queue: Queue | null = null;

// Fast-fail when Redis is absent (tests/local): enqueue/worker never hang and
// incident creation is never blocked by AI infra (same rule as email, §6.6).
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

export function getAiQueue(): Queue {
  if (!queue) {
    queue = new Queue(config.aiAnalysisQueueName, { connection: redisConnection() });
    queue.on('error', () => undefined);
  }
  return queue;
}

export interface AiAnalysisJobData {
  teamId: string;
  apiId: string;
  incidentId: string;
}

// Fire-and-forget entry point used right after incident creation. Never
// throws out of the caller (DoD (b)): a down queue leaves aiSummary null and
// the failure is only logged.
export async function enqueueAiAnalysis(input: AiAnalysisJobData): Promise<void> {
  if (!config.aiEnabled) {
    logger.warn('ai analysis enqueue skipped: AI_ENABLED=false');
    return;
  }
  try {
    await getAiQueue().add(JOB_NAME, input, {
      // PRD §6.6 guarantees >=1 retry; the longer exponential backoff widens
      // the window so a transient provider/network issue (or a corrected API
      // key) can self-heal instead of leaving an incident permanently un-analyzed.
      attempts: 6,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'ai analysis enqueue failed; incident created without analysis');
  }
}

// One graph run per delivery. Provider outage/timeout → persist aiSummary null,
// rethrow so BullMQ backs off and retries; after retries the job fails and
// ai_failed is logged (never thrown up to the incident path). Every failed
// attempt is logged so backoff retries are observable.
export async function processAiAnalysisJob(job: Job<AiAnalysisJobData>): Promise<void> {
  const attemptsMade = job.attemptsMade ?? 0;
  const totalAttempts = job.opts?.attempts ?? 2;

  if (!canSpendAiCall()) {
    await persistIncidentAnalysis(job.data.teamId, job.data.incidentId, { aiSummary: null, aiSuggestedCause: null });
    logger.warn({ incidentId: job.data.incidentId }, 'ai analysis skipped: not enabled or daily budget exhausted');
    return;
  }

  if (!canAttemptClaude()) {
    await persistIncidentAnalysis(job.data.teamId, job.data.incidentId, { aiSummary: null, aiSuggestedCause: null });
    logger.warn({ incidentId: job.data.incidentId }, 'ai analysis skipped: circuit breaker open');
    return;
  }

  recordAiCall();

  try {
    await runAnalysis({
      teamId: job.data.teamId,
      apiId: job.data.apiId,
      incidentId: job.data.incidentId,
    });
    recordClaudeSuccess();
  } catch (err) {
    recordClaudeFailure();
    await persistIncidentAnalysis(job.data.teamId, job.data.incidentId, { aiSummary: null, aiSuggestedCause: null });
    const failure = err instanceof Error ? err.message : String(err);
    const isFinal = attemptsMade + 1 >= totalAttempts;
    logger.warn(
      { err: failure, incidentId: job.data.incidentId, attempt: attemptsMade + 1, totalAttempts },
      isFinal ? 'ai_failed: retries exhausted, aiSummary=null' : 'ai_failed: attempt failed, backing off and retrying',
    );
    throw err;
  }
}

export async function startAiWorker(): Promise<Worker<AiAnalysisJobData>> {
  const worker = new Worker<AiAnalysisJobData>(config.aiAnalysisQueueName, processAiAnalysisJob, {
    connection: redisConnection(),
  });
  await worker.waitUntilReady();
  return worker;
}