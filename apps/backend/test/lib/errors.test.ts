import { describe, it, expect } from 'vitest';
import {
  AppError,
  AuthError,
  ForbiddenError,
  ConflictError,
  ValidationErrorShape,
  NotFoundError,
} from '../../src/lib/errors';

describe('AppError', () => {
  it('carries statusCode, code and details', () => {
    const err = new AppError(418, 'TEAPOT', 'msg', { a: 1 });
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.message).toBe('msg');
    expect(err.details).toEqual({ a: 1 });
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('error subclasses', () => {
  it('AuthError is 401 UNAUTHORIZED', () => {
    const err = new AuthError('nope');
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.name).toBe('AuthError');
  });

  it('ForbiddenError is 403 FORBIDDEN', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('ConflictError is 409 CONFLICT', () => {
    const err = new ConflictError('dup');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('ValidationErrorShape is 400 VALIDATION_ERROR with details', () => {
    const err = new ValidationErrorShape('bad', { field: 'x' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'x' });
  });

  it('NotFoundError is 404 NOT_FOUND', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });
});