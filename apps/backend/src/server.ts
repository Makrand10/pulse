import { config } from './config';
import { logger } from './lib/logger';
import { connectDb } from './lib/db';
import { connectRedis } from './lib/redis';
import { createApp } from './app';

async function main() {
  await connectDb(config.mongoUri);
  await connectRedis(config.redisUrl);
  logger.info('mongo + redis connected');

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`pulse backend listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err : new Error(String(err)) }, 'fatal startup error');
  process.exit(1);
});