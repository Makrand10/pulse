import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../../src/app';
import { connectDb, disconnectDb } from '../../src/lib/db';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

describe('auth HTTP routes', () => {
  it('signs up a new user and returns a token', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/auth/signup').send({
      name: 'Alice',
      email: 'alice@example.com',
      password: 'password123',
      teamName: 'Rocket',
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('alice@example.com');
    expect(res.body.user.role).toBe('admin');
    expect(res.body.team.name).toBe('Rocket');
  });

  it('does not allow duplicate signup emails', async () => {
    const app = createApp();
    await request(app).post('/api/v1/auth/signup').send({
      name: 'Bob',
      email: 'bob@example.com',
      password: 'password123',
      teamName: 'T',
    });
    const res = await request(app).post('/api/v1/auth/signup').send({
      name: 'Bob2',
      email: 'bob@example.com',
      password: 'password123',
      teamName: 'T2',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('logs in an existing user', async () => {
    const app = createApp();
    await request(app).post('/api/v1/auth/signup').send({
      name: 'Carol',
      email: 'carol@example.com',
      password: 'password123',
      teamName: 'T',
    });
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'carol@example.com',
      password: 'password123',
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('carol@example.com');
  });

  it('rejects login with a wrong password', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'carol@example.com',
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for invalid signup payload', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/auth/signup').send({
      name: '',
      email: 'not-an-email',
      password: 'short',
      teamName: '',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown routes', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});