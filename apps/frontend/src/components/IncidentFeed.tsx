'use client';

import { useState, type FormEvent } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { fetchJson, type IncidentDto } from '@/lib/api';
import { timeAgo } from '@/lib/format';

export function IncidentFeed({ apiId }: { apiId: string }) {
  const { token, role } = useAuth();
  const canResolve = role === 'admin' || role === 'manager';
  const { data: incidents, error, isLoading, mutate } = useSWR<IncidentDto[]>(
    token ? `/api/v1/incidents?apiId=${apiId}` : null,
    { refreshInterval: 30_000 },
  );

  return (
    <div className="card">
      <h2>Incidents</h2>
      {isLoading && <p className="muted">Loading incidents…</p>}
      {error && <p className="formError">{error.message}</p>}
      {incidents && incidents.length === 0 && <p className="muted">No incidents for this API.</p>}
      {incidents &&
        incidents.map((inc) => <IncidentRow key={inc.id} inc={inc} canResolve={canResolve} onMutate={mutate} />)}
    </div>
  );
}

function IncidentRow({
  inc,
  canResolve,
  onMutate,
}: {
  inc: IncidentDto;
  canResolve: boolean;
  onMutate: () => void;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim() || busy) return;
    setBusy(true);
    try {
      await fetchJson(`/api/v1/incidents/${inc.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ message: comment.trim() }),
      });
      setComment('');
      onMutate();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (busy) return;
    setBusy(true);
    try {
      await fetchJson(`/api/v1/incidents/${inc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'RESOLVED' }),
      });
      onMutate();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '12px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span className={`chip ${inc.status}`}>{inc.status}</span>
          <span className="muted">opened {timeAgo(inc.startedAt)}</span>
        </div>
        {inc.status !== 'RESOLVED' && canResolve && (
          <button className="secondary" onClick={resolve} disabled={busy}>
            Mark resolved
          </button>
        )}
      </div>
      {inc.aiSummary && <div className="aisummary">{inc.aiSummary}</div>}
      {inc.aiSuggestedCause && <p className="muted">Suggested cause: {inc.aiSuggestedCause}</p>}
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--muted)' }}>
        {inc.timeline.map((ev, i) => (
          <li key={i}>
            {timeAgo(ev.at)} — {ev.message}
          </li>
        ))}
      </ul>
      <form onSubmit={addComment} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          maxLength={1000}
        />
        <button type="submit" className="secondary" disabled={busy}>
          Comment
        </button>
      </form>
    </div>
  );
}