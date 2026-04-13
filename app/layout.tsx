import type { Metadata } from 'next';
import '../styles/globals.css';
import { AppShell } from '../components/layout/AppShell';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FlowSeer — TG20/W251 Borderplex',
  description: 'BOP Procurement Intelligence Platform · Trans World Power LLC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
