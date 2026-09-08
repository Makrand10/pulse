import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authGuard, adminOnly, requireTeam, extractBearerToken } from '../../src/middleware/auth';
import { signToken } from '../../src/modules/auth/token';
import { ForbiddenError } from '../../src/lib/errors';

function makeReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, ...overrides } as Request;
}

function makeRes(): Response {
  return {} as Response;
}

function nextSpy() {
  const calls: unknown[] = [];
  const fn = (err?: unknown) => calls.push(err);
  return { calls, fn };
}

describe('extractBearerToken', () => {
  it('extracts a bearer token from the Authorization header', () => {
    const req = makeReq({ headers: { authorization: 'Bearer abc123' } });
    expect(extractBearerToken(req)).toBe('abc123');
  });

  it('returns null when header is missing', () => {
    expect(extractBearerToken(makeReq())).toBeNull();
  });

  it('returns null when header is not a Bearer token', () => {
    const req = makeReq({ headers: { authorization: 'Basic abc123' } });
    expect(extractBearerToken(req)).toBeNull();
  });
});

describe('authGuard', () => {
  it('attaches decoded identity when token is valid', () => {
    const token = signToken({ sub: 'u1', email: 'a@b.com', teamId: 't1', role: 'admin' });
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const spy = nextSpy();

    authGuard(req, makeRes(), spy.fn);

    expect(spy.calls).toEqual([undefined]);
    expect(req.userId).toBe('u1');
    expect(req.teamId).toBe('t1');
    expect(req.role).toBe('admin');
  });

  it('rejects a missing token', () => {
    const req = makeReq();
    const spy = nextSpy();

    authGuard(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(Error);
    expect((spy.calls[0] as Error).message).toMatch(/token/i);
  });

  it('rejects an invalid token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer not-a-real-token' } });
    const spy = nextSpy();

    authGuard(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(Error);
    expect((spy.calls[0] as Error).message).toMatch(/token/i);
  });

  it('rejects an expired token', () => {
    const expired = signToken({ sub: 'u1', email: 'a@b.com', teamId: 't1', role: 'admin' }).slice(0, -12) + 'aB';
    const req = makeReq({ headers: { authorization: `Bearer ${expired}` } });
    const spy = nextSpy();

    authGuard(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(Error);
  });
});

describe('requireTeam', () => {
  it('allows a user with an attached teamId', () => {
    const req = makeReq() as Request & { teamId?: string; userId?: string; role?: string };
    req.teamId = 't1';
    const spy = nextSpy();

    requireTeam()(req, makeRes(), spy.fn);
    expect(spy.calls).toEqual([undefined]);
  });

  it('blocks a user without a team', () => {
    const req = makeReq() as Request & { teamId?: string; userId?: string; role?: string };
    const spy = nextSpy();

    requireTeam()(req, makeRes(), spy.fn);
    expect(spy.calls[0]).toBeInstanceOf(ForbiddenError);
  });
});

describe('adminOnly', () => {
  it('allows an admin', () => {
    const req = makeReq() as Request & { role?: string };
    req.role = 'admin';
    const spy = nextSpy();

    adminOnly(req, makeRes(), spy.fn);
    expect(spy.calls).toEqual([undefined]);
  });

  it('rejects a member with ForbiddenError (403)', () => {
    const req = makeReq() as Request & { role?: string };
    req.role = 'member';
    const spy = nextSpy();

    adminOnly(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(ForbiddenError);
    expect((spy.calls[0] as ForbiddenError).statusCode).toBe(403);
  });
});