import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyToken, type DecodedToken } from '../modules/auth/token';
import { AuthError, ForbiddenError } from '../lib/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: DecodedToken;
      userId?: string;
      teamId?: string;
      role?: 'admin' | 'member';
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