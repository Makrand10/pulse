'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
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
import { fetchJson, type ApiDetailDto, type CheckDto, type TeamMemberDto } from '@/lib/api';
import { fmtPct, fmtLatency } from '@/lib/format';
import { IncidentFeed } from '@/components/IncidentFeed';

function AlertRulesCard({ api, onSaved }: { api: ApiDetailDto; onSaved: () => void }) {
  const { token } = useAuth();
  const { data: members, error: membersError, isLoading } = useSWR<TeamMemberDto[]>(
    token ? '/api/v1/teams/members' : null,
  );
  const [selected, setSelected] = useState<string[]>(api.alertUserIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelected(api.alertUserIds ?? []);
  }, [api.alertUserIds]);

  function toggle(id: string) {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await fetchJson(`/api/v1/apis/${api.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ alertUserIds: selected }),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Alert recipients</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Choose who receives emails for this API. With none selected, the whole team is notified.
      </p>
      {isLoading && <p className="muted">Loading members…</p>}
      {membersError && <p className="formError">{membersError.message}</p>}
      {members && members.length === 0 && <p className="muted">No team members yet.</p>}
      {members && members.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {members.map((m) => (
            <label key={m.id} className="inline" style={{ marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={selected.includes(m.id)}
                onChange={() => toggle(m.id)}
              />
              <span>
                {m.name} <span className="muted">{m.email}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {error && <p className="formError">{error}</p>}
      {saved && <p className="muted">Saved.</p>}
      <button onClick={save} disabled={saving || !members}>
        {saving ? 'Saving…' : 'Save alert rules'}
      </button>
    </div>
  );
}

export default function ApiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, role } = useAuth();
  const { mutate } = useSWRConfig();
  const isAdmin = role === 'admin';

  const { data: api, error: apiError } = useSWR<ApiDetailDto>(token ? `/api/v1/apis/${id}` : null, {
    refreshInterval: 15_000,
  });
  const { data: checks, error: checksError } = useSWR<CheckDto[]>(
    token ? `/api/v1/apis/${id}/checks?limit=200` : null,
    { refreshInterval: 60_000 },
  );

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
  const publicPath =
    api.isPublic && api.teamSlug && api.slug ? `/status/${api.teamSlug}/${api.slug}` : null;

  return (
    <div>
      <p className="muted">
        <Link href={isAdmin ? '/apis' : '/home'}>← {isAdmin ? 'All APIs' : 'Dashboard'}</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{api.name}</h1>
          <p className="muted">
            {api.method} {api.url} · expected {api.expectedStatus}
          </p>
          {publicPath && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Public status page:{' '}
              <a href={publicPath} target="_blank" rel="noreferrer">
                {publicPath}
              </a>
            </p>
          )}
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
        {checksError && <p className="formError">{checksError.message}</p>}
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

      {isAdmin && <AlertRulesCard api={api} onSaved={() => mutate(`/api/v1/apis/${id}`)} />}

      <IncidentFeed apiId={id} />
    </div>
  );
}