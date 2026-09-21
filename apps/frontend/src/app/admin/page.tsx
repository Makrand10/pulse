'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import {
  fetchJson,
  type TeamDto,
  type DirectoryUserDto,
} from '@/lib/api';

export default function AdminHomePage() {
  const { token, role, activeTeamId, setActiveTeam } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.replace('/admin/login');
    else if (role && role !== 'admin') router.replace('/home');
  }, [token, role, router]);

  const { data: teams, mutate: mutateTeams } = useSWR<TeamDto[]>(token && role === 'admin' ? '/api/v1/teams' : null);
  const { data: directory, mutate: mutateDirectory } = useSWR<DirectoryUserDto[]>(
    token && role === 'admin' ? '/api/v1/teams/directory' : null,
  );

  const [newTeam, setNewTeam] = useState('');
  const [inviteTeamId, setInviteTeamId] = useState<string>(activeTeamId ?? '');
  const [inviteRoles, setInviteRoles] = useState<Record<string, 'user' | 'manager'>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (teams && teams.length > 0 && !inviteTeamId) {
      setInviteTeamId(activeTeamId && teams.some((t) => t.id === activeTeamId) ? activeTeamId : teams[0]!.id);
    }
  }, [teams, activeTeamId, inviteTeamId]);

  async function onCreateTeam(e: FormEvent) {
    e.preventDefault();
    if (!newTeam.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const team = await fetchJson<TeamDto>('/api/v1/teams', {
        method: 'POST',
        body: JSON.stringify({ name: newTeam.trim() }),
      });
      setNewTeam('');
      setNotice(`Team "${team.name}" created.`);
      await mutateTeams();
      setInviteTeamId(team.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create team');
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(user: DirectoryUserDto) {
    if (!inviteTeamId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/teams/${inviteTeamId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, role: inviteRoles[user.id] ?? 'user' }),
      });
      setNotice(`Invited ${user.name} to the selected team.`);
      await mutateDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invite');
    } finally {
      setBusy(false);
    }
  }

  if (!token || role !== 'admin') return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Admin console</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Register teams, invite members and manage the APIs each team monitors.
      </p>

      {error && <p className="formError">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      <div className="card">
        <h2>Your teams</h2>
        {!teams ? (
          <p className="muted">Loading teams…</p>
        ) : teams.length === 0 ? (
          <p className="muted">No teams yet — create one below.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Team ID</th>
                <th>Slug</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {t.id}
                  </td>
                  <td className="muted">{t.slug ?? '—'}</td>
                  <td>
                    <button
                      className="secondary"
                      style={{ padding: '6px 12px' }}
                      onClick={() => {
                        setActiveTeam(t.id);
                        router.push('/apis');
                      }}
                    >
                      Manage APIs
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={onCreateTeam} className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="newTeam">New team name</label>
            <input id="newTeam" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="e.g. Search Squad" />
          </div>
          <button type="submit" disabled={busy}>
            Create team
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Invite members</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick a team, then invite a registered user. They join after accepting.
        </p>
        {!teams || teams.length === 0 ? (
          <p className="muted">Create a team first.</p>
        ) : (
          <>
            <label htmlFor="inviteTeam">Team</label>
            <select
              id="inviteTeam"
              value={inviteTeamId}
              onChange={(e) => setInviteTeamId(e.target.value)}
              style={{ maxWidth: 320 }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {!directory ? (
              <p className="muted">Loading users…</p>
            ) : directory.length === 0 ? (
              <p className="muted">No users have signed up yet.</p>
            ) : (
              <table className="table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Access</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {directory.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td className="muted">{u.email}</td>
                      <td>
                        <select
                          value={inviteRoles[u.id] ?? 'user'}
                          onChange={(e) =>
                            setInviteRoles((prev) => ({
                              ...prev,
                              [u.id]: e.target.value as 'user' | 'manager',
                            }))
                          }
                          style={{ width: 140 }}
                        >
                          <option value="user">User</option>
                          <option value="manager">Manager</option>
                        </select>
                      </td>
                      <td className="muted">{u.teamId ? 'In a team' : 'Unassigned'}</td>
                      <td>
                        <button
                          className="secondary"
                          style={{ padding: '6px 12px' }}
                          disabled={busy}
                          onClick={() => onInvite(u)}
                        >
                          Invite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <p className="muted">
        <Link href="/apis">Go to monitored APIs →</Link>
      </p>
    </div>
  );
}
