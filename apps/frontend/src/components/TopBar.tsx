'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export function TopBar() {
  const { token, name, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="topbar">
      <div className="row">
        <Link href={token ? '/apis' : '/'} className="brand">
          Pulse
        </Link>
      </div>
      <nav>
        {token ? (
          <>
            <Link href="/apis">APIs</Link>
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
            <Link href="/register">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}