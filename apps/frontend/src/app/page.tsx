'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { token, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.replace('/login');
    else if (role === 'admin') router.replace('/admin');
    else router.replace('/home');
  }, [token, role, router]);

  return <p className="muted">Redirecting…</p>;
}