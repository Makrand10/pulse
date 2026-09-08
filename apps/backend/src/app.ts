import express from 'express';
import cors from 'cors';
import httpLogger from 'pino-http';
import { router as apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger, newRequestId } from './lib/logger';
import { getConnection } from './lib/db';
import { getRedis, setLoggerForRedis } from './lib/redis';

setLoggerForRedis(logger);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());

  app.use(
    httpLogger({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string) || newRequestId(),
      serializers: {
        req: (r) => ({ id: r.id, method: r.method, url: r.url }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
      redact: {
        paths: ['req.headers.authorization'],
        censor: '[REDACTED]',
      },
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/readyz', (_req, res) => {
    const dbReady = getConnection().readyState === 1;
    const redis = getRedis();
    const checks: Record<string, string> = { mongo: dbReady ? 'up' : 'down' };

    try {
      void redis;
      checks.redis = 'up';
    } catch {
      checks.redis = 'down';
    }

    const ready = checks.mongo === 'up' && checks.redis === 'up';
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}