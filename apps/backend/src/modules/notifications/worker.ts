import { startNotificationWorker } from './queue';
import { connectDb } from '../../lib/db';
import { ensureSlugs } from '../../db/slugs';
import { config } from '../../config';
import { logger } from '../../lib/logger';

// Separate deploy target: "npm run notify" — email sending never blocks the
// API server or the Temporal worker.
async function main(): Promise<void> {
  await connectDb(config.mongoUri);
  await ensureSlugs();
  const worker = await startNotificationWorker();
  logger.info(`notification worker listening on queue "${config.notifyQueueName}"`);

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'notification worker fatal error');
  process.exit(1);
});