'use client';

import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { fetchPublicStatus, type PublicStatusDto } from '@/lib/api';
import { fmtPct, fmtLatency, timeAgo } from '@/lib/format';

export default function PublicStatusPage() {
  const { teamSlug, apiSlug } = useParams<{ teamSlug: string; apiSlug: string }>();
  const { data, error, isLoading } = useSWR<PublicStatusDto>(
    teamSlug && apiSlug ? ['public-status', teamSlug, apiSlug] : null,
    () => fetchPublicStatus(teamSlug, apiSlug),
    { refreshInterval: 15_000 },
  );

  if (isLoading) {
    return (
      <div className="card">
        <p className="muted">Loading status…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <h1>Status page unavailable</h1>
        <p className="muted">{error ? error.message : 'This status page could not be loaded.'}</p>
      </div>
    );
  }

  const status = data.status;
  const statusLabel = status?.status ?? 'UNKNOWN';

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{data.name}</h1>
          <p className="muted">
            {data.method} {data.url} · expected {data.expectedStatus}
          </p>
        </div>
        <div className="row">
          <span className={`statusDot ${status?.status ?? 'DEGRADED'}`} />
          <span style={{ fontWeight: 600 }}>{statusLabel}</span>
        </div>
      </div>

      <div className="grid cols" style={{ marginTop: 20 }}>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            24h uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(data.uptime?.pct24h ?? null)}
          </p>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            7d uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(data.uptime?.pct7d ?? null)}
          </p>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            30d uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(data.uptime?.pct30d ?? null)}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Latest check</h2>
        {status ? (
          <p style={{ margin: 0 }}>
            {status.status} · {fmtLatency(status.latencyMs)}
            {typeof status.statusCode === 'number' ? ` · HTTP ${status.statusCode}` : ''}
            <span className="muted"> · checked {timeAgo(status.checkedAt)}</span>
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            No checks recorded yet.
          </p>
        )}
      </div>
    </div>
  );
}