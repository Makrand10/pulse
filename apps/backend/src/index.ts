import type { ApiConfig } from '@pulse/shared-types';

const apiConfig: ApiConfig = {
  name: 'placeholder',
  url: 'https://example.com',
  method: 'GET',
  expectedStatus: 200,
  latencyThresholdMs: 1000,
  intervalSeconds: 60,
  isActive: true,
  isPublic: false,
};

export function getScaffoldConfig(): ApiConfig {
  return apiConfig;
}