'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiCreateSchema } from '@pulse/shared-types';
import { fetchJson, type ApiDto } from '@/lib/api';

export default function NewApiPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    url: '',
    method: 'GET',
    expectedStatus: '200',
    latencyThresholdMs: '1000',
    intervalSeconds: '60',
    authToken: '',
    body: '',
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = apiCreateSchema.safeParse({
      name: form.name,
      url: form.url,
      method: form.method,
      expectedStatus: Number(form.expectedStatus),
      latencyThresholdMs: Number(form.latencyThresholdMs),
      intervalSeconds: Number(form.intervalSeconds),
      authToken: form.authToken || undefined,
      body: form.body || undefined,
      isActive: form.isActive,
    });

    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      setError(issues);
      return;
    }

    setSubmitting(true);
    try {
      const created = await fetchJson<ApiDto>('/api/v1/apis', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      router.push(`/apis/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Add API</h1>
      <p className="muted">Pulse will begin monitoring this endpoint on an interval.</p>

      <form onSubmit={onSubmit}>
        <label htmlFor="name">Name</label>
        <input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Payments API" required />

        <label htmlFor="url">URL</label>
        <input id="url" value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://api.example.com/health" required />

        <label htmlFor="method">HTTP method</label>
        <select id="method" value={form.method} onChange={(e) => set('method', e.target.value)}>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="HEAD">HEAD</option>
        </select>

        <div className="grid cols" style={{ marginTop: 4 }}>
          <div>
            <label htmlFor="expectedStatus">Expected status</label>
            <input id="expectedStatus" type="number" value={form.expectedStatus} onChange={(e) => set('expectedStatus', e.target.value)} />
          </div>
          <div>
            <label htmlFor="latencyThresholdMs">Latency threshold (ms)</label>
            <input id="latencyThresholdMs" type="number" value={form.latencyThresholdMs} onChange={(e) => set('latencyThresholdMs', e.target.value)} />
          </div>
          <div>
            <label htmlFor="intervalSeconds">Check interval (s)</label>
            <input id="intervalSeconds" type="number" value={form.intervalSeconds} onChange={(e) => set('intervalSeconds', e.target.value)} />
          </div>
        </div>

        <label htmlFor="authToken">Auth token (optional)</label>
        <input id="authToken" value={form.authToken} onChange={(e) => set('authToken', e.target.value)} placeholder="Bearer token sent on each check" />

        <label htmlFor="body">Request body (optional, POST only)</label>
        <textarea id="body" value={form.body} onChange={(e) => set('body', e.target.value)} rows={3} />

        <label className="inline" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Monitoring enabled immediately
        </label>

        {error && <p className="formError">{error}</p>}

        <p style={{ marginTop: 18 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create API'}
          </button>
        </p>
      </form>
    </div>
  );
}