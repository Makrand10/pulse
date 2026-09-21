import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  authGuard,
  adminOnly,
  managerOrAdmin,
  requireTeam,
  resolveTeam,
  extractBearerToken,
} from '../../src/middleware/auth';
import { signToken } from '../../src/modules/auth/token';
import { ForbiddenError } from '../../src/lib/errors';

vi.mock('../../src/modules/teams/repository', () => ({
  isTeamAdmin: vi.fn(),
  isActiveTeamMember: vi.fn(),
}));

import { isTeamAdmin, isActiveTeamMember } from '../../src/modules/teams/repository';

const mockedIsTeamAdmin = vi.mocked(isTeamAdmin);
const mockedIsActiveTeamMember = vi.mocked(isActiveTeamMember);

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

function resolveReq(init: {
  role?: string;
  userId?: string;
  teamId?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  const headers = init.headers ?? {};
  return {
    headers,
    role: init.role,
    userId: init.userId,
    teamId: init.teamId,
    query: init.query ?? {},
    body: init.body,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
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

  it('returns null for an empty bearer token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer    ' } });
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

describe('managerOrAdmin', () => {
  it.each(['admin', 'manager'])('allows a %s', (role) => {
    const req = makeReq() as Request & { role?: string };
    req.role = role;
    const spy = nextSpy();

    managerOrAdmin(req, makeRes(), spy.fn);
    expect(spy.calls).toEqual([undefined]);
  });

  it('rejects a plain user with ForbiddenError (403)', () => {
    const req = makeReq() as Request & { role?: string };
    req.role = 'user';
    const spy = nextSpy();

    managerOrAdmin(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(ForbiddenError);
    expect((spy.calls[0] as ForbiddenError).statusCode).toBe(403);
  });
});

describe('resolveTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses an administered team explicitly requested in the query string', async () => {
    mockedIsTeamAdmin.mockResolvedValue(true);
    const req = resolveReq({ role: 'admin', userId: 'u1', query: { teamId: 'q1' } });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsTeamAdmin).toHaveBeenCalledWith('u1', 'q1');
    expect(req.teamId).toBe('q1');
    expect(spy.calls).toEqual([undefined]);
  });

  it('falls back to body.teamId when the query does not set one', async () => {
    mockedIsTeamAdmin.mockResolvedValue(true);
    const req = resolveReq({ role: 'admin', userId: 'u1', body: { teamId: 'b1' } });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsTeamAdmin).toHaveBeenCalledWith('u1', 'b1');
    expect(req.teamId).toBe('b1');
  });

  it('falls back to the x-team-id header last', async () => {
    mockedIsTeamAdmin.mockResolvedValue(true);
    const req = resolveReq({ role: 'admin', userId: 'u1', headers: { 'x-team-id': 'h1' } });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsTeamAdmin).toHaveBeenCalledWith('u1', 'h1');
    expect(req.teamId).toBe('h1');
  });

  it('treats the "all" sentinel as no team filter', async () => {
    const req = resolveReq({ role: 'admin', userId: 'u1', teamId: 'tok', query: { teamId: 'all' } });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsTeamAdmin).not.toHaveBeenCalled();
    expect(req.teamId).toBeUndefined();
    expect(spy.calls).toEqual([undefined]);
  });

  it('rejects a team the admin does not administer', async () => {
    mockedIsTeamAdmin.mockResolvedValue(false);
    const req = resolveReq({ role: 'admin', userId: 'u1', query: { teamId: 'other' } });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(spy.calls[0]).toBeInstanceOf(ForbiddenError);
    expect(req.teamId).toBeUndefined();
  });

  it("keeps the admin's token team when none is requested", async () => {
    const req = resolveReq({ role: 'admin', userId: 'u1', teamId: 'tok' });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsTeamAdmin).not.toHaveBeenCalled();
    expect(req.teamId).toBe('tok');
  });

  it('keeps a member team while the membership is active', async () => {
    mockedIsActiveTeamMember.mockResolvedValue(true);
    const req = resolveReq({ role: 'user', userId: 'u2', teamId: 't1' });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsActiveTeamMember).toHaveBeenCalledWith('u2', 't1');
    expect(req.teamId).toBe('t1');
  });

  it('drops the team when the membership is no longer active', async () => {
    mockedIsActiveTeamMember.mockResolvedValue(false);
    const req = resolveReq({ role: 'manager', userId: 'u2', teamId: 't1' });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(req.teamId).toBeUndefined();
    expect(spy.calls).toEqual([undefined]);
  });

  it('leaves a teamless member without a team', async () => {
    const req = resolveReq({ role: 'user', userId: 'u2' });
    const spy = nextSpy();

    await resolveTeam()(req, makeRes(), spy.fn);

    expect(mockedIsActiveTeamMember).not.toHaveBeenCalled();
    expect(req.teamId).toBeUndefined();
  });
});