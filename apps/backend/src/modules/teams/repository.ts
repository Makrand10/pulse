import { User, type UserDoc } from '../../db/models/User';
import { Team, type TeamDoc } from '../../db/models/Team';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { uniqueSlug } from '../../db/slugs';
export interface NewUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role?: 'admin' | 'manager' | 'user' | 'member';
}

export async function createUser(input: NewUserInput): Promise<UserDoc> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw new ConflictError('A user with this email already exists');
  }
  return User.create(input);
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  return User.findOne({ email: email.toLowerCase() });
}

export async function findUserById(id: string): Promise<UserDoc | null> {
  return User.findById(id);
}

export async function createTeam(name: string, ownerUserId: string): Promise<TeamDoc> {
  return Team.create({
    name,
    slug: await uniqueSlug(Team, {}, name),
    ownerId: ownerUserId,
    members: [{ userId: ownerUserId, role: 'admin', status: 'active' }],
  });
}

// Teams the caller can act on. An admin owns (or is an active admin member of)
// any number of teams; a manager/user belongs to exactly one (User.teamId).
export async function listTeamsForUser(userId: string, role: string): Promise<TeamDoc[]> {
  if (role === 'admin') {
    return Team.find({
      $or: [
        { ownerId: userId },
        { members: { $elemMatch: { userId, role: 'admin', status: 'active' } } },
      ],
    })
      .sort({ createdAt: 1 })
      .exec();
  }
  const user = await findUserById(userId);
  if (!user?.teamId) return [];
  const team = await Team.findById(user.teamId);
  return team ? [team] : [];
}

export async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const team = await Team.findOne({
    _id: teamId,
    $or: [
      { ownerId: userId },
      { members: { $elemMatch: { userId, role: 'admin', status: 'active' } } },
    ],
  }).select('_id');
  return Boolean(team);
}

export async function isActiveTeamMember(userId: string, teamId: string): Promise<boolean> {
  const member = await Team.exists({
    _id: teamId,
    members: { $elemMatch: { userId, status: 'active' } },
  });
  return Boolean(member);
}

// Users who signed up through the user/manager portal — the pool an admin can
// invite. Returned with their current team so the UI can show who is unassigned.
export async function listDirectory(): Promise<
  { id: string; name: string; email: string; role: string; teamId: string | null }[]
> {
  const users = await User.find({ role: { $in: ['user', 'manager', 'member'] } })
    .sort({ createdAt: 1 })
    .lean();
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role ?? 'user',
    teamId: u.teamId ? String(u.teamId) : null,
  }));
}

// Invitation lives on the team as a member with status "invited"; the user is
// only attached (User.teamId) once they accept.
export async function inviteUserToTeam(teamId: string, userId: string, role: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('User not found');

  const team = await getTeam(teamId);
  const existing = team.members.find((m) => String(m.userId) === userId);
  if (existing) {
    if (existing.status === 'active' && String(user.teamId) === teamId) {
      throw new ConflictError('This user is already a member of the team');
    }
    existing.role = role as TeamDoc['members'][number]['role'];
    existing.status = 'invited';
  } else {
    team.members.push({ userId: user._id, role, status: 'invited' } as never);
  }
  await saveTeam(team);
}

export async function listInvitationsForUser(userId: string): Promise<
  { teamId: string; teamName: string; teamSlug: string | null; role: string }[]
> {
  const teams = await Team.find({
    members: { $elemMatch: { userId, status: 'invited' } },
  }).lean();
  return teams.map((t) => ({
    teamId: String(t._id),
    teamName: t.name,
    teamSlug: t.slug ?? null,
    role: (t.members.find((m) => String(m.userId) === userId)?.role as string) ?? 'user',
  }));
}

// Accepting attaches the user to the team and refreshes their role. A user can
// belong to one team at a time, so this replaces any previous membership.
export async function acceptInvitation(
  teamId: string,
  userId: string,
): Promise<{ team: TeamDoc; role: string }> {
  const team = await getTeam(teamId);
  const member = team.members.find((m) => String(m.userId) === userId);
  if (!member) {
    throw new NotFoundError('No invitation found for this team');
  }
  member.status = 'active';
  await saveTeam(team);

  await User.updateOne({ _id: userId }, { teamId, role: member.role ?? 'user' });
  return { team, role: member.role ?? 'user' };
}

// Team roster for the alert-rules editor and recipient validation. Team
// membership is the single User.teamId field (a user has exactly one team).
export async function listTeamMembers(teamId: string): Promise<
  { id: string; userId: string; name: string; email: string; role: string }[]
> {
  const users = await User.find({ teamId }, { name: 1, email: 1, role: 1 }).lean();
  return users.map((u) => ({
    id: String(u._id),
    userId: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role ?? 'member',
  }));
}

export async function getTeamSlug(teamId: string): Promise<string | null> {
  const team = await Team.findById(teamId).select('slug').lean();
  return team?.slug ?? null;
}

export async function getTeamNames(teamIds: string[]): Promise<Record<string, string>> {
  if (teamIds.length === 0) return {};
  const teams = await Team.find({ _id: { $in: teamIds } }, { name: 1 }).lean();
  return Object.fromEntries(teams.map((t) => [String(t._id), t.name]));
}

export async function attachUserToTeam(userId: string, teamId: string, role: string): Promise<void> {
  await User.updateOne({ _id: userId }, { teamId, role });
}

export async function getTeamById(teamId: string): Promise<TeamDoc | null> {
  return Team.findById(teamId);
}

export async function getTeam(teamId: string): Promise<TeamDoc> {
  const team = await Team.findById(teamId);
  if (!team) {
    throw new NotFoundError('Team not found');
  }
  return team;
}

export async function saveTeam(team: TeamDoc): Promise<TeamDoc> {
  return team.save();
}