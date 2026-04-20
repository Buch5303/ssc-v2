'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { TopBar } from './TopBar';
import { ErrorBoundary } from '../ui/ErrorBoundary';

const nav = [
  { href: '/dashboard/overview',         label: 'Overview',         dot: true  },
  { href: '/dashboard/cost-intel',        label: 'Cost Intelligence',dot: false },
  { href: '/dashboard/supplier-network',  label: 'Supplier Network', dot: false },
  { href: '/dashboard/rfq-pipeline',      label: 'RFQ Pipeline',     dot: true  },
  { href: '/dashboard/analytics',          label: 'Analytics',        dot: false },
  { href: '/dashboard/log-response',        label: 'Log Response',     dot: false },
  { href: '/dashboard/send-rfq',             label: 'Send RFQs',        dot: false },
  { href: '/dashboard/risk',                 label: 'Risk Assessment',  dot: true  },
  { href: '/dashboard/threat-radar',         label: 'Threat Radar',     dot: true  },
  { href: '/dashboard/incentive-radar',      label: 'Incentive Radar',  dot: true  },
  { href: '/dashboard/automation',           label: 'Automation',       dot: true  },
  { href: '/dashboard/settings',             label: 'Settings',         dot: false },
];

// FlowSeer F-mark SVG
function FMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="4" fill="#0B1220"/>
      <path d="M6 5h13l-2.5 4H9v3h6.5l-2.5 4h-4v8H6V5z" fill="#1E6FCC"/>
      <path d="M14 5h5l-7 18h-3.5z" fill="#DCE8F6" opacity="0.8"/>
      <path d="M17.5 5H22l-7 18h-3.5z" fill="#CC2020"/>
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg0)' }}>

      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 flex flex-col" style={{
        background: 'var(--bg1)',
        borderRight: '1px solid var(--line)',
      }}>

        {/* Brand */}
        <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2.5">
            <FMark />
            <div>
              <div className="text-[13px] font-bold tracking-[-0.2px]">
                <span style={{ color: 'var(--t0)' }}>Flow</span>
                <span style={{ color: 'var(--brand-red)' }}>Seer</span>
              </div>
              <div className="font-mono text-[9px] mt-[1px]" style={{ color: 'var(--brand-blue2)', opacity: 0.8, letterSpacing: '0.5px' }}>
                TG20/W251 · BORDERPLEX
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-[2px]">
          {nav.map(({ href, label, dot }) => {
            const active = path.startsWith(href);
            return (
              <Link key={href} href={href} className={clsx(
                'flex items-center gap-2.5 px-3 py-[8px] text-[11px] font-medium transition-all',
                'font-[IBM_Plex_Sans]',
                active
                  ? 'bg-[#1E6FCC]/10 border border-[#1E6FCC]/20 text-[--t0]'
                  : 'text-[--t2] hover:text-[--t1] hover:bg-[--bg3] border border-transparent',
              )}>
                {dot && (
                  <span className={clsx(
                    'w-[4px] h-[4px] rounded-full flex-shrink-0',
                    active ? 'bg-[--t2]' : 'bg-[--red]',
                  )} />
                )}
                {!dot && <span className="w-[4px] flex-shrink-0" />}
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="font-mono text-[8px] leading-[1.6]" style={{ color: 'var(--t3)' }}>
            <div>Trans World Power LLC</div>
            <div>Client: Borderplex</div>
            <div>Santa Teresa, NM</div>
          </div>
        </div>

      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar />
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </div>
      </main>

    </div>
  );
}
