'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SWRConfig, useSWRConfig } from 'swr';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  fetchJson,
  SESSION_EXPIRED_EVENT,
  setLoginNotice,
} from '@/lib/api';

const swrConfig = {
  fetcher: (path: string) => fetchJson(path),
  refreshInterval: 15_000,
  revalidateOnFocus: true,
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SWRConfig value={swrConfig}>
        <SessionCoordinator>{children}</SessionCoordinator>
      </SWRConfig>
    </AuthProvider>
  );
}

function isProtectedPath(pathname: string): boolean {
  if (pathname === '/admin/login' || pathname === '/admin/register') return false;
  return (
    pathname === '/home' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/apis' ||
    pathname.startsWith('/apis/')
  );
}

function SessionCoordinator({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { initialized, token, clearSession, logout } = useAuth();
  const { mutate } = useSWRConfig();
  const [revalidating, setRevalidating] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const activeCheck = useRef<Promise<void> | null>(null);
  const previousToken = useRef(token);
  const expiredHandled = useRef(false);
  const protectedPath = isProtectedPath(pathname);

  const revalidate = useCallback((): Promise<void> => {
    if (activeCheck.current) return activeCheck.current;
    const check = (async () => {
      if (!isProtectedPath(window.location.pathname)) return;
      const storedToken = window.localStorage.getItem('pulse_token');
      if (!storedToken) {
        setLoginNotice('Login required.');
        logout();
        router.replace('/login');
        return;
      }

      setRevalidating(true);
      setVerificationError(null);
      try {
        // This existing protected endpoint validates the JWT without changing
        // API contracts. Do not sign out on network, 403, or other errors.
        await fetchJson('/api/v1/teams');
      } catch {
        if (window.localStorage.getItem('pulse_token')) {
          setVerificationError('Unable to verify your session. Check your connection and retry.');
        }
      } finally {
        setRevalidating(false);
      }
    })();
    activeCheck.current = check;
    void check.finally(() => {
      if (activeCheck.current === check) activeCheck.current = null;
    });
    return check;
  }, [logout, router]);

  useEffect(() => {
    if (!initialized) return;
    const onRestore = () => void revalidate();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onRestore();
    };
    const onSessionExpired = (event: Event) => {
      if (expiredHandled.current) return;
      expiredHandled.current = true;
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setLoginNotice(message ?? 'Your session has expired. Please log in again.');
      clearSession();
      if (isProtectedPath(window.location.pathname)) router.replace('/login');
    };

    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('popstate', onRestore);
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('popstate', onRestore);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, [initialized, revalidate, clearSession, router]);

  useEffect(() => {
    if (previousToken.current !== token) {
      previousToken.current = token;
      void mutate(() => true, undefined, { revalidate: false });
    }
    if (!protectedPath) expiredHandled.current = false;
  }, [token, pathname, protectedPath, mutate]);

  useEffect(() => {
    if (initialized && protectedPath && token) void revalidate();
  }, [initialized, protectedPath, pathname, token, revalidate]);

  useEffect(() => {
    if (initialized && protectedPath && !token) {
      setLoginNotice('Login required.');
      router.replace('/login');
    }
  }, [initialized, protectedPath, token, router]);

  if (protectedPath && (!initialized || !token || revalidating || verificationError)) {
    return (
      <p className="muted" role="status" aria-busy={revalidating}>
        {verificationError ?? 'Verifying session…'}{' '}
        {verificationError && <button onClick={() => void revalidate()}>Retry</button>}
      </p>
    );
  }
  return children;
}
