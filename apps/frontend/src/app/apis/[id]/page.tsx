'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/lib/auth';
import type { ApiDetailDto, CheckDto } from '@/lib/api';
import { fmtPct, fmtLatency } from '@/lib/format';
import { IncidentFeed } from '@/components/IncidentFeed';

export default function ApiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();

  const { data: api, error: apiError } = useSWR<ApiDetailDto>(token ? `/api/v1/apis/${id}` : null, {
    refreshInterval: 15_000,
  });
  const { data: checks } = useSWR<CheckDto[]>(token ? `/api/v1/apis/${id}/checks?limit=200` : null, {
    refreshInterval: 60_000,
  });

  if (apiError) {
    return (
      <div className="card">
        <p className="formError">{apiError.message}</p>
        <Link href="/apis">Back to APIs</Link>
      </div>
    );
  }
  if (!api) return <p className="muted">Loading…</p>;

  const lastError = api.currentStatus?.errorMessage;
  const latencyData = (checks ?? []).map((c, i) => ({ i, latency: c.latencyMs, status: c.status }));

  return (
    <div>
      <p className="muted">
        <Link href="/apis">← All APIs</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{api.name}</h1>
          <p className="muted">
            {api.method} {api.url} · expected {api.expectedStatus}
          </p>
        </div>
        <div className="row">
          <span className={`statusDot ${api.currentStatus?.status ?? 'UP'}`} />
          <span className="muted">
            {api.currentStatus
              ? `${api.currentStatus.status} · ${fmtLatency(api.currentStatus.latencyMs)}`
              : 'No checks yet'}
          </span>
        </div>
      </div>

      <div className="grid cols" style={{ marginTop: 20 }}>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            24h uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(api.uptime.pct24h)}
          </p>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            7d uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(api.uptime.pct7d)}
          </p>
        </div>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            30d uptime
          </p>
          <p className="bigStat" style={{ margin: '4px 0 0' }}>
            {fmtPct(api.uptime.pct30d)}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Latency (last 200 checks)</h2>
        {latencyData.length === 0 ? (
          <p className="muted">No checks recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={latencyData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e6ea" />
              <XAxis dataKey="i" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => `${v} ms`} />
              <Line
                type="monotone"
                dataKey="latency"
                stroke="#2f6fed"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        {lastError && <p className="muted">Last error: {lastError}</p>}
      </div>

      <IncidentFeed apiId={id} />
    </div>
  );
}