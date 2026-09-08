import { createClient, type RedisClientType } from 'redis';

let client: RedisClientType | null = null;

let redisLogger: { warn(msg: string): void } = { warn: () => undefined };

export function setLoggerForRedis(l: { warn(msg: string): void }) {
  redisLogger = l;
}

export function getRedis(): RedisClientType {
  if (!client) {
    throw new Error('Redis client is not connected. Call connectRedis() first.');
  }
  return client;
}

export async function connectRedis(url: string): Promise<void> {
  if (client) return;
  client = createClient({ url });
  client.on('error', (err) => redisLogger.warn(`redis error: ${err.message}`));
  await client.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  await client.quit();
  client = null;
}