import { Api } from './models/Api';
import { Team } from './models/Team';
import { User } from './models/User';

// Human-readable slugs for the public status route /public/status/:teamSlug/:apiSlug.
// Uniqueness is enforced at the app layer via uniqueSlug() and ensureSlugs()
// (deterministic retry with a numeric suffix) because backfilling a unique
// index over pre-existing rows that lack the field is order-sensitive.

// Structural subset of a Mongoose model so typed models (Team, Api) satisfy it.
interface SlugModel {
  exists(filter: Record<string, unknown>): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function uniqueSlug(model: SlugModel, filter: Record<string, unknown>, name: string): Promise<string> {
  const base = slugify(name) || 'item';
  let slug = base;
  let i = 2;
  while (await model.exists({ ...filter, slug })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function setSlugSafely(model: SlugModel, id: unknown, slug: string): Promise<void> {
  try {
    await model.updateOne({ _id: id }, { $set: { slug } } as unknown as Record<string, unknown>);
  } catch (err) {
    // A concurrent process may have won the slug race; the unique index then
    // protects the field, so a duplicate-key write is safe to ignore here.
    if (!(err instanceof Error && /E11000|duplicate key/i.test(err.message))) throw err;
  }
}

async function backfillTeams(): Promise<void> {
  const teams = await Team.find({ $or: [{ slug: { $exists: false } }, { slug: '' }] }).exec();
  const used = new Set<string>();
  for (const team of teams) {
    const name = String(team.name ?? 'team');
    let slug = slugify(name) || 'team';
    let i = 2;
    while (used.has(slug) || (await Team.exists({ slug }))) {
      slug = `${slugify(name) || 'team'}-${i++}`;
    }
    used.add(slug);
    await setSlugSafely(Team, team._id, slug);
  }
}

async function backfillApis(): Promise<void> {
  const apis = await Api.find({ $or: [{ slug: { $exists: false } }, { slug: '' }] }).exec();
  const usedByTeam = new Map<string, Set<string>>();
  for (const api of apis) {
    const teamId = String(api.teamId);
    const used = usedByTeam.get(teamId) ?? new Set<string>();
    const name = String(api.name ?? 'api');
    let slug = slugify(name) || 'api';
    let i = 2;
    while (used.has(slug) || (await Api.exists({ teamId, slug }))) {
      slug = `${slugify(name) || 'api'}-${i++}`;
    }
    used.add(slug);
    usedByTeam.set(teamId, used);
    await setSlugSafely(Api, api._id, slug);
  }
}

// One-time legacy cleanup for the roles/teams pivot:
//  - role "member" is the old name for a view-only team user
//  - teams created before multi-team support have no ownerId; adopt the
//    earliest admin listed in members so they keep managing the team
async function migrateLegacyRolesAndOwners(): Promise<void> {
  await User.updateMany({ role: 'member' }, { $set: { role: 'user' } });

  const orphaned = await Team.find({ $or: [{ ownerId: null }, { ownerId: { $exists: false } }] }).exec();
  for (const team of orphaned) {
    const admin = team.members.find((m) => m.role === 'admin');
    if (admin?.userId) {
      await Team.updateOne({ _id: team._id }, { $set: { ownerId: admin.userId } });
    }
  }
}

// Assigns missing slugs to existing rows, then reconciles indexes so the
// unique constraints are never evaluated against documents without a slug.
// syncIndexes() (not init()) also drops stale index definitions left by earlier
// schema revisions — e.g. a non-sparse unique `slug_1` — which would otherwise
// collide by name. Safe to call on every boot (idempotent).
export async function ensureSlugs(): Promise<void> {
  await backfillTeams();
  await backfillApis();
  await migrateLegacyRolesAndOwners();
  await Promise.all([Team.syncIndexes(), Api.syncIndexes(), User.syncIndexes()]);
}