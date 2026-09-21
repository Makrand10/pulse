import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../../src/lib/db';
import { Team } from '../../src/db/models/Team';
import { Api } from '../../src/db/models/Api';
import { ensureSlugs, slugify, uniqueSlug } from '../../src/db/slugs';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}, 120000);

afterAll(async () => {
  await disconnectDb();
  if (mongo) await mongo.stop();
});

describe('slug generation', () => {
  it('normalizes names into url-safe slugs', () => {
    expect(slugify('Payments API!!')).toBe('payments-api');
    expect(slugify('  My   Cool_Service  ')).toBe('my-cool-service');
    expect(slugify('Café · Résumé')).toBe('cafe-resume');
    expect(slugify('###')).toBe('');
  });

  it('appends a numeric suffix on collision', async () => {
    await Team.create({ name: 'Collision', slug: 'collision' });
    const slug = await uniqueSlug(Team, {}, 'Collision');
    expect(slug).toBe('collision-2');
  });

  it('falls back to a default base when the name has no usable characters', async () => {
    const slug = await uniqueSlug(Team, {}, '###');
    expect(slug).toBe('item');
  });
});

describe('ensureSlugs backfill', () => {
  it('assigns missing team and api slugs and de-duplicates within a team', async () => {
    const teamId = new Types.ObjectId().toString();
    await Team.create({ name: 'Legacy Team' });
    // Two same-named APIs in one team, both without slugs.
    await Api.create({ teamId, name: 'Payments API', url: 'https://a.example' });
    await Api.create({ teamId, name: 'Payments API', url: 'https://b.example' });

    await ensureSlugs();

    const team = await Team.findOne({ name: 'Legacy Team' });
    expect(team!.slug).toBe('legacy-team');

    const apis = await Api.find({ teamId }).sort({ url: 1 });
    expect(apis.map((a) => a.slug)).toEqual(['payments-api', 'payments-api-2']);
  });

  it('is idempotent — existing slugs are untouched', async () => {
    const team = await Team.create({ name: 'Idempotent', slug: 'custom-slug' });
    await ensureSlugs();
    const reloaded = await Team.findById(team._id);
    expect(reloaded!.slug).toBe('custom-slug');
  });
});