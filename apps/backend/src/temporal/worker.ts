import path from 'node:path';
import fs from 'node:fs';
import { NativeConnection, Worker } from '@temporalio/worker';
import { config } from '../config';
import { connectDb } from '../lib/db';
import { connectRedis } from '../lib/redis';
import { logger } from '../lib/logger';
import { TASK_QUEUE } from './shared';
import * as activities from './activities';

async function main(): Promise<void> {
  await connectDb(config.mongoUri);
  await connectRedis(config.redisUrl);

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  // ts-node-dev runs from src/, prod runs from build/dist. Pick whichever exists.
  const sourcePath = path.join(__dirname, 'workflows.ts');
  const workflowsPath = fs.existsSync(sourcePath) ? sourcePath : path.join(__dirname, 'workflows.js');

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
  });

  logger.info(`health-check worker listening on task queue "${TASK_QUEUE}" @ ${config.temporalAddress}`);
  await worker.run();
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err : new Error(String(err)) }, 'worker fatal error');
  process.exit(1);
});