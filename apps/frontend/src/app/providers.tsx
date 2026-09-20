'use client';

import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { AuthProvider } from '@/lib/auth';
import { fetchJson } from '@/lib/api';

const swrConfig = {
  fetcher: (path: string) => fetchJson(path),
  refreshInterval: 15_000,
  revalidateOnFocus: true,
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SWRConfig value={swrConfig}>{children}</SWRConfig>
    </AuthProvider>
  );
}