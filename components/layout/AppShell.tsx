'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard/overview',        label: 'Overview',          icon: '◈' },
  { href: '/dashboard/cost-intel',      label: 'Cost Intel',        icon: '◉' },
  { href: '/dashboard/supplier-network',label: 'Supplier Network',  icon: '◎' },
  { href: '/dashboard/rfq-pipeline',    label: 'RFQ Pipeline',      icon: '◇' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e1a]">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-[#0f1524] border-r border-white/[0.06]">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <div className="text-[11px] font-mono font-bold text-cyan-400 tracking-widest uppercase">FlowSeer</div>
          <div className="text-[9px] font-mono text-slate-500 mt-0.5">SSC V2 Intelligence</div>
        </div>
        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const active = path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-[10px] font-mono font-medium transition-all ${
                  active
                    ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                }`}
              >
                <span className="text-sm">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.06]">
          <div className="text-[8px] font-mono text-slate-600">TWP / Project Jupiter</div>
          <div className="text-[8px] font-mono text-slate-600 mt-0.5">W251 TG20B7-8 · $10.1M BOP</div>
        </div>
      </aside>
      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
