import type { Metadata } from 'next';
import { Providers } from './providers';
import { TopBar } from '@/components/TopBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pulse — API Monitor',
  description: 'Self-hosted multi-tenant API uptime monitoring with AI incident analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try { document.documentElement.dataset.theme = localStorage.getItem('pulse_theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }",
          }}
        />
      </head>
      <body>
        <Providers>
          <TopBar />
          <main className="wrap">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
