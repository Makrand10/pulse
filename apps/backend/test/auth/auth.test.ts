import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password';
import { signToken, verifyToken } from '../../src/modules/auth/token';
import { config } from '../../src/config';

describe('password hashing', () => {
  it('hashes a password and round-trips a correct plaintext', async () => {
    const hash = await hashPassword('super-secret-1');
    expect(hash).not.toBe('super-secret-1');
    expect(await verifyPassword('super-secret-1', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('super-secret-1');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});

describe('JWT token', () => {
  const payload = { sub: 'u1', email: 'a@b.com', teamId: 't1', role: 'admin' as const };

  it('signs and verifies a token round-trip', () => {
    const token = signToken(payload);
    expect(token).toContain('.');
    const decoded = verifyToken(token);
    expect(decoded).toMatchObject(payload);
  });

  it('rejects a tampered token', () => {
    const token = signToken(payload);
    const [head, body] = token.split('.');
    const tampered = `${head}.${body.slice(0, -2)}XX.thing`;
    expect(() => verifyToken(tampered)).toThrow();
  });

  it('rejects an empty token', () => {
    expect(() => verifyToken('')).toThrow();
  });

  it('rejects a token whose payload is not an object', () => {
    const token = jwt.sign('just-a-string', config.jwtSecret);
    expect(() => verifyToken(token)).toThrow(/malformed/i);
  });
});