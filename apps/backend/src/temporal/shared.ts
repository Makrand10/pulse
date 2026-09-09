export const TASK_QUEUE = 'health-checks';

export const WORKFLOW_NAME = 'healthCheckWorkflow';

export function workflowIdForApi(apiId: string): string {
  return `healthcheck-${apiId}`;
}