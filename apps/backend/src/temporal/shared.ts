export const TASK_QUEUE = 'health-checks';

export const WORKFLOW_NAME = 'healthCheckWorkflow';

export const UPTIME_WORKFLOW_NAME = 'uptimeRollupWorkflow';
export const UPTIME_WORKFLOW_ID = 'uptime-rollup-v1';
export const UPTIME_CRON_SCHEDULE = '0 * * * *'; // hourly (PRD §6.4)

export function workflowIdForApi(apiId: string): string {
  return `healthcheck-${apiId}`;
}