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
} as const;

export type Config = typeof config;