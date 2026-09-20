import { startAiWorker } from './queue';
import { connectDb } from '../../lib/db';
import { config } from '../../config';
import { logger } from '../../lib/logger';

// Separate deploy target: "npm run ai-worker" — Claude analysis is fully
// decoupled from the API server, incident engine, and email worker.
async function main(): Promise<void> {
  await connectDb(config.mongoUri);
  const worker = await startAiWorker();
  logger.info(`ai analysis worker listening on queue "${config.aiAnalysisQueueName}"`);

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'ai analysis worker fatal error');
  process.exit(1);
});