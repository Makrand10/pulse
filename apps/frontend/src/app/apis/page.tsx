'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@/lib/auth';
import { fetchJson, type ApiDto, type TeamDto } from '@/lib/api';
import type { LatestCheck } from '@pulse/shared-types';

function HealthCell({ currentStatus }: { currentStatus?: LatestCheck | null }) {
  if (!currentStatus) return <span className="muted">No checks</span>;
  return (
    <span className="row">
      <span className={`statusDot ${currentStatus.status}`} />
      <span>{currentStatus.status}</span>
    </span>
  );
}

export default function ApisPage() {
  const { token, role, activeTeamId, setActiveTeam } = useAuth();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [filter, setFilter] = useState<string>(activeTeamId ?? 'all');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) router.replace('/admin/login');
    else if (role && role !== 'admin') router.replace('/home');
  }, [token, role, router]);

  const { data: teams } = useSWR<TeamDto[]>(token && role === 'admin' ? '/api/v1/teams' : null);
  const listKey = token && role === 'admin' ? `/api/v1/apis?teamId=${filter}` : null;
  const { data, error, isLoading } = useSWR<ApiDto[]>(listKey);

  function onFilterChange(value: string) {
    setFilter(value);
    setActiveTeam(value === 'all' ? null : value);
  }

  async function onDelete(api: ApiDto) {
    setBusyId(api.id);
    setActionError(null);
    try {
      await fetchJson(`/api/v1/apis/${api.id}`, { method: 'DELETE' });
      setConfirmingId(null);
      await mutate(listKey);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  if (!token || role !== 'admin') return <p className="muted">Redirecting…</p>;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1>Monitored APIs</h1>
          <p className="muted" style={{ margin: 0 }}>
            Uptime statistics and incident analysis across your teams.
          </p>
        </div>
        <Link href="/apis/new">
          <button>Add API</button>
        </Link>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <label htmlFor="teamFilter" style={{ margin: 0 }}>
          Filter by team
        </label>
        <select
          id="teamFilter"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          style={{ maxWidth: 260 }}
        >
          <option value="all">All teams</option>
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="formError">{error.message}</p>}
      {actionError && <p className="formError">{actionError}</p>}
      {data && data.length === 0 && (
        <div className="card">
          <p className="muted">
            No APIs for this filter. <Link href="/apis/new">Register an API</Link>.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Team</th>
                <th>URL</th>
                <th>Method</th>
                <th>Status</th>
                <th>Health</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((api) => (
                <tr key={api.id}>
                  <td>
                    <Link
                      href={`/apis/${api.id}`}
                      onClick={() => setActiveTeam(api.teamId)}
                    >
                      {api.name}
                    </Link>
                  </td>
                  <td className="muted">{api.teamName ?? '—'}</td>
                  <td className="muted">{api.url}</td>
                  <td>{api.method}</td>
                  <td>{api.isActive ? 'Active' : 'Paused'}</td>
                  <td>
                    <HealthCell currentStatus={api.currentStatus} />
                  </td>
                  <td>
                    {confirmingId === api.id ? (
                      <span className="row">
                        <button
                          onClick={() => onDelete(api)}
                          disabled={busyId === api.id}
                          style={{ background: 'var(--down)', padding: '6px 12px' }}
                        >
                          {busyId === api.id ? 'Deleting…' : 'Confirm delete'}
                        </button>
                        <button className="secondary" onClick={() => setConfirmingId(null)} style={{ padding: '6px 12px' }}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button className="secondary" onClick={() => setConfirmingId(api.id)} style={{ padding: '6px 12px' }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
