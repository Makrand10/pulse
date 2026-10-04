'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { consumeLoginNotice } from '@/lib/api';

export default function LoginPage() {
  const { initialized, token, role, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNotice(consumeLoginNotice());
  }, []);

  useEffect(() => {
    if (initialized && token) router.replace(role === 'admin' ? '/admin' : '/home');
  }, [initialized, token, role, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const role = await login(email, password);
      router.replace(role === 'admin' ? '/admin' : '/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!initialized || token) return <p className="muted">Checking session…</p>;

  return (
    <div className="card" style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>User &amp; manager log in</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        For team members who were invited by an admin.
      </p>
      {notice && <p role="status" className="formError">{notice}</p>}
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        {error && <p className="formError">{error}</p>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </p>
      </form>
      <p className="muted">
        No account? <Link href="/register">Sign up</Link>.
      </p>
      <p className="muted">
        Team owner? <Link href="/admin/login">Admin log in</Link>.
      </p>
    </div>
  );
}
