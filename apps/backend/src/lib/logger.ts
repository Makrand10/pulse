import { randomUUID } from 'node:crypto';
import pino, { type Logger } from 'pino';

const serializers = {
  req(req: { id?: string; method?: string; url?: string }) {
    return { id: req.id, method: req.method, url: req.url };
  },
  res(res: { statusCode?: number }) {
    return { statusCode: res.statusCode };
  },
};

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  serializers,
  redact: {
    paths: [
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.authToken',
    ],
    censor: '[REDACTED]',
  },
});

export type { Logger };

export function newRequestId(): string {
  return randomUUID();
}