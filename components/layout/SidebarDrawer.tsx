'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMobileSwipe } from '../../hooks/useMobileSwipe';

interface SidebarDrawerProps {
  open: boolean;
  onClose: () => void;
}

const NAVIGATION_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/overview', label: 'Overview' },
  { href: '/rfq', label: 'RFQ Pipeline' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/cost-intel', label: 'Cost Intelligence' },
  { href: '/dashboard/pricing-directives', label: 'Pricing Directives' },
  { href: '/dashboard/supplier-network', label: 'Supplier Network' },
  { href: '/dashboard/risk', label: 'Risk Analysis' },
  { href: '/dashboard/automation', label: 'Automation' },
  { href: '/dashboard/audit-trail', label: 'Audit Trail' },
  { href: '/dashboard/settings', label: 'Settings' }
];

export function SidebarDrawer({ open, onClose }: SidebarDrawerProps) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);

  useMobileSwipe(drawerRef, {
    onSwipeLeft: onClose
  });

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div 
        ref={drawerRef}
        className={`fixed top-0 left-0 h-full w-80 bg-card border-r border-border z-50 transition-transform duration-300 md:relative md:translate-x-0 md:z-auto ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-fg">Navigation</h2>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg md:hidden"
              aria-label="Close navigation"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <nav className="space-y-1">
            {NAVIGATION_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`block px-4 py-3 rounded-lg transition-colors font-mono ${
                    isActive 
                      ? 'bg-accent/10 text-accent border border-accent/20' 
                      : 'text-muted hover:bg-muted hover:text-fg'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </>
  );
}