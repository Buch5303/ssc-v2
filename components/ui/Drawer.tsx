'use client';
import { useEffect } from 'react';
import { clsx } from 'clsx';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  width?: string;
}

export function Drawer({ open, onClose, title, subtitle, children, width = '560px' }: DrawerProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        style={{ background: 'rgba(7,12,19,0.72)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={clsx(
          'fixed top-0 right-0 bottom-0 z-50 flex flex-col overflow-hidden transition-transform duration-250',
        )}
        style={{
          width,
          background: 'var(--bg1)',
          borderLeft: '1px solid var(--line)',
          transform: open ? 'translateX(0)' : `translateX(${width})`,
          transition: 'transform 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div>
            <div className="font-mono text-[9px] tracking-[2px] uppercase mb-1" style={{ color: 'var(--t3)' }}>
              {subtitle}
            </div>
            <div className="text-[14px] font-semibold" style={{ color: 'var(--t0)' }}>{title}</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center font-mono text-[14px] transition-colors"
            style={{ color: 'var(--t2)', background: 'var(--bg2)', border: '1px solid var(--line)' }}
          >×</button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </>
  );
}
