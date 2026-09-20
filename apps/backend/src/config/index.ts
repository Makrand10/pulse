import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  env: optionalEnv('NODE_ENV', 'development'),
  port: Number(optionalEnv('PORT', '4000')),
  mongoUri: requiredEnv('MONGO_URI'),
  redisUrl: requiredEnv('REDIS_URL'),
  jwtSecret: requiredEnv('JWT_SECRET'),
  jwtExpiresIn: optionalEnv('JWT_EXPIRES_IN', '7d'),
  bcryptRounds: Number(optionalEnv('BCRYPT_ROUNDS', '12')),
  encryptionKey: requiredEnv('ENCRYPTION_KEY'),
  temporalAddress: optionalEnv('TEMPORAL_ADDRESS', 'localhost:7233'),
  temporalNamespace: optionalEnv('TEMPORAL_NAMESPACE', 'default'),
  resendApiKey: optionalEnv('RESEND_API_KEY', ''),
  emailFrom: optionalEnv('EMAIL_FROM', 'Pulse <alerts@pulse.dev>'),
  appBaseUrl: optionalEnv('APP_BASE_URL', 'http://localhost:3000'),
  notifyQueueName: optionalEnv('NOTIFY_QUEUE_NAME', 'pulse-notifications'),
  emailMaxAttempts: Number(optionalEnv('EMAIL_MAX_ATTEMPTS', '5')),
  emailBackoffMs: Number(optionalEnv('EMAIL_BACKOFF_MS', '5000')),
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
  aiEnabled: optionalEnv('AI_ENABLED', 'true') === 'true',
  aiTimeoutMs: Number(optionalEnv('AI_TIMEOUT_MS', '10000')),
  aiAnalysisQueueName: optionalEnv('AI_ANALYSIS_QUEUE_NAME', 'pulse-ai-analysis'),
  aiModel: optionalEnv('AI_MODEL', 'claude-sonnet-4-20250514'),
  aiMaxTokens: Number(optionalEnv('AI_MAX_TOKENS', '300')),
  aiDailyCallCap: Number(optionalEnv('AI_DAILY_CALL_CAP', '10')),
} as const;

export type Config = typeof config;