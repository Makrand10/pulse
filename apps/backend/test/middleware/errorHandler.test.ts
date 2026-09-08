import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ZodError, z } from 'zod';
import { AppError, AuthError } from '../../src/lib/errors';
import { errorHandler, notFoundHandler, setErrorLogger } from '../../src/middleware/errorHandler';

function makeRes() {
  const res = {
    statusCode: 200,
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: unknown, body: unknown) {
      return { ...this, body };
    }),
  } as unknown as Response;
  return res;
}

function makeReq() {
  return { method: 'GET', path: '/x', headers: {} } as unknown as Request;
}

describe('errorHandler', () => {
  it('maps a ZodError to 400 VALIDATION_ERROR', () => {
    const schema = z.object({ n: z.number() });
    let thrown: unknown;
    try {
      schema.parse({ n: 'x' });
    } catch (e) {
      thrown = e;
    }
    const res = makeRes();
    const next = vi.fn();

    errorHandler(thrown as ZodError, makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.results[0].value.body;
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(next).not.toHaveBeenCalled();
  });

  it('maps an AppError to its status code', () => {
    const res = makeRes();
    const next = vi.fn();
    errorHandler(new AuthError('bad'), makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.results[0].value.body;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('maps invalid JSON to 400 INVALID_JSON', () => {
    const err = new SyntaxError('Unexpected token') as SyntaxError & { status: number };
    err.status = 400;
    const res = makeRes();
    errorHandler(err, makeReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.results[0].value.body;
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('maps unknown errors to 500 INTERNAL_ERROR', () => {
    const res = makeRes();
    errorHandler(new Error('boom'), makeReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.results[0].value.body;
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('logs unknown errors via the configured logger', () => {
    const spy = vi.fn();
    setErrorLogger({ error: spy } as unknown as Parameters<typeof setErrorLogger>[0]);
    errorHandler(new Error('boom'), makeReq(), makeRes(), vi.fn());
    expect(spy).toHaveBeenCalled();
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with a machine-readable code', () => {
    const res = makeRes();
    notFoundHandler(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.results[0].value.body;
    expect(body.error.code).toBe('NOT_FOUND');
  });
});