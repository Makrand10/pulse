import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pulse',
  description: 'API reliability & incident management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}