import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { runAnalysis } from './graph';
import { persistIncidentAnalysis } from '../incidents/repository';
import { canAttemptClaude, recordClaudeSuccess, recordClaudeFailure } from './breaker';

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
  try {
    await getAiQueue().add(JOB_NAME, input, {
      attempts: 2, // one original + one retry per PRD "enqueue one retry"
      backoff: { type: 'fixed', delay: 15_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'ai analysis enqueue failed; incident created without analysis');
  }
}

// One graph run per delivery. Claude outage/timeout → persist aiSummary null,
// rethrow so BullMQ performs the single retry; after retries the job fails and
// ai_failed is logged (never thrown up to the incident path).
export async function processAiAnalysisJob(job: Job<AiAnalysisJobData>): Promise<void> {
  const attemptsMade = job.attemptsMade ?? 0;

  if (!canAttemptClaude()) {
    await persistIncidentAnalysis(job.data.teamId, job.data.incidentId, { aiSummary: null, aiSuggestedCause: null });
    logger.warn({ incidentId: job.data.incidentId }, 'ai analysis skipped: circuit breaker open');
    return;
  }

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
    if (attemptsMade + 1 >= (job.opts?.attempts ?? 2)) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), incidentId: job.data.incidentId },
        'ai_failed: Claude retries exhausted, aiSummary=null',
      );
    }
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