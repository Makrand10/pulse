import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('API cache controls', () => {
  it('marks API responses private and non-cacheable, including auth failures', async () => {
    const response = await request(createApp()).get('/api/v1/apis');

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('does not apply the authenticated API cache policy to the public surface', async () => {
    const response = await request(createApp()).get('/public/not-a-status-route');

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBeUndefined();
  });
});
