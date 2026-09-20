import { evaluateStreak, DEFAULT_FAILURE_THRESHOLD, DEFAULT_SUCCESS_THRESHOLD } from './stateMachine';
import { findOpenIncident, getRecentCheckStatuses, createIncident, resolveIncident } from './repository';
import { getApiForWorker } from '../healthchecks/repository';
import { notifyIncidentEvent } from '../notifications/service';
import { enqueueAiAnalysis } from '../ai-analysis/queue';

const STREAK_WINDOW = Math.max(DEFAULT_FAILURE_THRESHOLD, DEFAULT_SUCCESS_THRESHOLD);

// Runs after persistCheckResult: evaluates the latest streak for an API and
// opens or auto-resolves its incident (flapping guard enforced by the pure
// state machine). Idempotent for at-least-once activity retries: an already
// open incident is never re-created, an already resolved one is never re-resolved.
export async function applyIncidentEngine(input: { apiId: string; teamId: string }): Promise<void> {
  const { apiId, teamId } = input;

  const recent = await getRecentCheckStatuses(teamId, apiId, STREAK_WINDOW);
  const open = await findOpenIncident(teamId, apiId);
  const decision = evaluateStreak(
    recent,
    DEFAULT_FAILURE_THRESHOLD,
    DEFAULT_SUCCESS_THRESHOLD,
    Boolean(open),
  );

  if (decision === 'OPEN' && !open) {
    const incident = await createIncident(teamId, apiId, `Open after ${DEFAULT_FAILURE_THRESHOLD} consecutive failures`);
    const api = await getApiForWorker(apiId);
    await notifyIncidentEvent({
      teamId,
      apiId,
      incidentId: String(incident._id),
      type: 'INCIDENT_OPENED',
      apiName: api?.name ?? 'Unknown API',
    });
    // Fire-and-forget root-cause analysis (§6.6): enqueue never blocks or
    // throws out of the incident path; on queue/Claude failure aiSummary stays
    // null and the worker retries once.
    await enqueueAiAnalysis({ teamId, apiId, incidentId: String(incident._id) });
  } else if (decision === 'RESOLVE' && open) {
    const incident = await resolveIncident(teamId, String(open._id), `Auto-resolved after ${DEFAULT_SUCCESS_THRESHOLD} consecutive successes`);
    if (incident) {
      const api = await getApiForWorker(apiId);
      await notifyIncidentEvent({
        teamId,
        apiId,
        incidentId: String(incident._id),
        type: 'INCIDENT_RESOLVED',
        apiName: api?.name ?? 'Unknown API',
      });
    }
  }
}