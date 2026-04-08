import type { Metadata } from 'next';
import '../styles/globals.css';
import { AppShell } from '../components/layout/AppShell';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FlowSeer — SSC V2 Procurement Intelligence',
  description: 'W251 Power Island BOP Procurement Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
