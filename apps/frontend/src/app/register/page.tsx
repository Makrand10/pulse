'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { signupMember } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'manager'>('user');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await signupMember(name, email, password, role);
      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1>User &amp; manager sign up</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Create an account, then an admin can invite you to their team.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Your name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <label htmlFor="password">Password (min 8 characters)</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        <label htmlFor="role">I am a…</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'manager')}>
          <option value="user">User (view &amp; comment)</option>
          <option value="manager">Manager (view, comment &amp; resolve)</option>
        </select>
        {error && <p className="formError">{error}</p>}
        <p style={{ marginTop: 16 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Sign up'}
          </button>
        </p>
      </form>
      <p className="muted">
        Already have an account? <Link href="/login">Log in</Link>.
      </p>
      <p className="muted">
        Want to create a team? <Link href="/admin/register">Admin sign up</Link>.
      </p>
    </div>
  );
}
