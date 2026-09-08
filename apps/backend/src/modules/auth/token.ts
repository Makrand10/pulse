import jwt from 'jsonwebtoken';
import { config } from '../../config';
import type { Role } from '@pulse/shared-types';
import { AuthError } from '../../lib/errors';

export interface JwtPayload {
  sub: string;
  email: string;
  teamId: string | null;
  role: Role;
}

export interface DecodedToken {
  sub: string;
  email: string;
  teamId: string | null;
  role: Role;
}

export function signToken(payload: JwtPayload): string {
  const options: jwt.SignOptions = { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyToken(token: string): DecodedToken {
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded === 'string') {
      throw new AuthError('Malformed token');
    }
    const { sub, email, teamId, role } = decoded as DecodedToken;
    return { sub, email, teamId, role };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired token');
  }
}