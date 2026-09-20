import { config } from './config';
import { logger } from './lib/logger';
import { connectDb } from './lib/db';
import { connectRedis } from './lib/redis';
import { createApp } from './app';
import { startUptimeRollupWorkflow } from './temporal/lifecycle';

async function main() {
  await connectDb(config.mongoUri);
  await connectRedis(config.redisUrl);
  logger.info('mongo + redis connected');

  // Hourly §6.4 uptime aggregation (idempotent; Temporal not required for the
  // rest of the app to boot, so a missing server is only a warning).
  startUptimeRollupWorkflow().catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'temporal unavailable; uptime rollup cron not started');
  });

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`pulse backend listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err : new Error(String(err)) }, 'fatal startup error');
  process.exit(1);
});