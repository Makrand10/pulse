import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyToken, type DecodedToken } from '../modules/auth/token';
import { AuthError, ForbiddenError } from '../lib/errors';
import { isTeamAdmin, isActiveTeamMember } from '../modules/teams/repository';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: DecodedToken;
      userId?: string;
      teamId?: string;
      role?: 'admin' | 'manager' | 'user' | 'member';
    }
  }
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export const authGuard: RequestHandler = (req, _res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw new AuthError('Missing bearer token');
    }
    const decoded = verifyToken(token);
    req.auth = decoded;
    req.userId = decoded.sub;
    req.teamId = decoded.teamId ?? undefined;
    req.role = decoded.role;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireTeam = (): RequestHandler => (req, _res: Response, next: NextFunction) => {
  if (!req.teamId) {
    next(new ForbiddenError('This user is not part of a team yet'));
    return;
  }
  next();
};

export const adminOnly: RequestHandler = (req, _res, next) => {
  if (req.role !== 'admin') {
    next(new ForbiddenError('Admin role required'));
    return;
  }
  next();
};

export const managerOrAdmin: RequestHandler = (req, _res, next) => {
  if (req.role !== 'admin' && req.role !== 'manager') {
    next(new ForbiddenError('Manager or admin role required'));
    return;
  }
  next();
};

// Resolves which team the request applies to and stores it on req.teamId.
// - admin: the team is chosen per request via the x-team-id header (falling
//   back to ?teamId / body.teamId) and must be one they own or administer.
//   With none supplied, req.teamId stays undefined so list endpoints can span
//   all of the admin's teams.
// - manager/user: the team comes from their token; a membership that is no
//   longer active is treated as "no team" (routes that need one 403 via
//   requireTeam). This is deliberately non-throwing so teamless users can still
//   reach invitation endpoints.
export const resolveTeam = (): RequestHandler => async (req, _res, next) => {
  try {
    if (req.role === 'admin') {
      // Explicit per-request team (query or body) wins over the stored active
      // team header; "all" means "span every team I own".
      const requested =
        (typeof req.query.teamId === 'string' ? req.query.teamId : undefined) ??
        (typeof req.body?.teamId === 'string' ? req.body.teamId : undefined) ??
        (req.header('x-team-id') as string | undefined);
      if (requested === 'all') {
        req.teamId = undefined;
      } else if (requested) {
        if (!(await isTeamAdmin(req.userId!, requested))) {
          throw new ForbiddenError('No access to this team');
        }
        req.teamId = requested;
      }
      // otherwise keep the token's team (the admin's primary team)
    } else if (req.teamId && !(await isActiveTeamMember(req.userId!, req.teamId))) {
      req.teamId = undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
};