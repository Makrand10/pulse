'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@/lib/auth';
import { fetchJson, type ApiDto } from '@/lib/api';
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
  const { token } = useAuth();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR<ApiDto[]>(token ? '/api/v1/apis' : null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onDelete(api: ApiDto) {
    setBusyId(api.id);
    setActionError(null);
    try {
      await fetchJson(`/api/v1/apis/${api.id}`, { method: 'DELETE' });
      setConfirmingId(null);
      await mutate('/api/v1/apis');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1>Monitored APIs</h1>
          <p className="muted" style={{ margin: 0 }}>
            Uptime statistics and incident analysis for your team&apos;s services.
          </p>
        </div>
        <Link href="/apis/new">
          <button>Add API</button>
        </Link>
      </div>

      {isLoading && <p className="muted">Loading…</p>}
      {error && <p className="formError">{error.message}</p>}
      {actionError && <p className="formError">{actionError}</p>}
      {data && data.length === 0 && (
        <div className="card">
          <p className="muted">
            No APIs yet. <Link href="/apis/new">Register your first API</Link> to start monitoring.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Method</th>
                <th>Latency threshold</th>
                <th>Status</th>
                <th>Health</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((api) => (
                <tr key={api.id}>
                  <td>
                    <Link href={`/apis/${api.id}`}>{api.name}</Link>
                  </td>
                  <td className="muted">{api.url}</td>
                  <td>{api.method}</td>
                  <td>{api.latencyThresholdMs}ms</td>
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