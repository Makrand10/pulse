'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import type { ApiDto } from '@/lib/api';

export default function ApisPage() {
  const { token } = useAuth();
  const { data, error, isLoading } = useSWR<ApiDto[]>(token ? '/api/v1/apis' : null);

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
      {data && data.length === 0 && (
        <div className="card">
          <p className="muted">
            No APIs yet. <Link href="/apis/new">Register your first API</Link> to start monitoring.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Method</th>
                <th>Latency threshold</th>
                <th>Status</th>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}