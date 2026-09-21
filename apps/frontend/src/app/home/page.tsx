'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import {
  fetchJson,
  type ApiDto,
  type IncidentDto,
  type InvitationDto,
  type AuthSuccess,
} from '@/lib/api';
import { timeAgo } from '@/lib/format';

export default function MemberHomePage() {
  const { token, role, name, activeTeamId, acceptAuth } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router]);

  const { data: invitations, mutate: mutateInvitations } = useSWR<InvitationDto[]>(
    token ? '/api/v1/teams/me/invitations' : null,
  );
  const { data: apis, isLoading: loadingApis } = useSWR<ApiDto[]>(
    token && activeTeamId ? '/api/v1/apis' : null,
  );
  const { data: incidents } = useSWR<IncidentDto[]>(
    token && activeTeamId ? '/api/v1/incidents' : null,
  );

  async function accept(teamId: string) {
    const data = await fetchJson<AuthSuccess>(`/api/v1/teams/${teamId}/invitations/accept`, {
      method: 'POST',
      headers: activeTeamId ? { 'x-team-id': activeTeamId } : undefined,
    });
    acceptAuth(data);
    await mutateInvitations();
  }

  if (!token) return <p className="muted">Redirecting…</p>;

  const openIncidents = (incidents ?? []).filter((i) => i.status !== 'RESOLVED');

  return (
    <div>
      <h1>Welcome{name ? `, ${name}` : ''}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {role === 'manager' ? 'Manager' : 'User'} dashboard — read-only view of your team.
      </p>

      {invitations && invitations.length > 0 && (
        <div className="card">
          <h2>Pending invitations</h2>
          {invitations.map((inv) => (
            <div key={inv.teamId} className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{inv.teamName}</strong> <span className="muted">as {inv.role}</span>
              </span>
              <button onClick={() => accept(inv.teamId)} style={{ padding: '6px 12px' }}>
                Accept
              </button>
            </div>
          ))}
        </div>
      )}

      {!activeTeamId ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            You are not part of a team yet. Ask an admin to invite you, then accept the invitation
            here.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>Your team&apos;s APIs</h2>
            {loadingApis ? (
              <p className="muted">Loading…</p>
            ) : !apis || apis.length === 0 ? (
              <p className="muted">No APIs monitored yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>URL</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {apis.map((api) => (
                    <tr key={api.id}>
                      <td>
                        <Link href={`/apis/${api.id}`}>{api.name}</Link>
                      </td>
                      <td className="muted">{api.url}</td>
                      <td>
                        {api.currentStatus ? (
                          <span className="row">
                            <span className={`statusDot ${api.currentStatus.status}`} />
                            <span>{api.currentStatus.status}</span>
                          </span>
                        ) : (
                          <span className="muted">No checks</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>Open incidents</h2>
            {openIncidents.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No open incidents. All clear.
              </p>
            ) : (
              openIncidents.map((inc) => (
                <div key={inc.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row">
                    <span className={`chip ${inc.status}`}>{inc.status}</span>
                    <span className="muted">opened {timeAgo(inc.startedAt)}</span>
                  </span>
                  <Link href={`/apis/${inc.apiId}`}>View</Link>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
