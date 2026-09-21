'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export function TopBar() {
  const { token, name, role, logout } = useAuth();
  const router = useRouter();
  const isAdmin = role === 'admin';

  return (
    <header className="topbar">
      <div className="row">
        <Link href={token ? (isAdmin ? '/admin' : '/home') : '/'} className="brand">
          Pulse
        </Link>
        {token && (
          <span className="chip" style={{ marginLeft: 8 }}>
            {isAdmin ? 'Admin' : role === 'manager' ? 'Manager' : 'User'}
          </span>
        )}
      </div>
      <nav>
        {token ? (
          <>
            {isAdmin ? (
              <>
                <Link href="/admin">Teams</Link>
                <Link href="/apis">APIs</Link>
              </>
            ) : (
              <Link href="/home">Dashboard</Link>
            )}
            <span className="user">{name ?? ''}</span>
            <Link
              href="/"
              onClick={(e) => {
                e.preventDefault();
                logout();
                router.push('/');
              }}
            >
              Log out
            </Link>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/admin/login">Admin</Link>
          </>
        )}
      </nav>
    </header>
  );
}
