import { User, type UserDoc } from '../../db/models/User';
import { Team, type TeamDoc } from '../../db/models/Team';
import { ConflictError, NotFoundError } from '../../lib/errors';

export interface NewUserInput {
  name: string;
  email: string;
  passwordHash: string;
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
    members: [{ userId: ownerUserId, role: 'admin' }],
  });
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