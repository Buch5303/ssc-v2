import { clsx } from 'clsx';
import { memo } from 'react';

type Accent = 'none' | 'critical' | 'warning';

interface KPIProps {
  label:    string;
  value:    string | number;
  sub?:     string;
  badge?:   React.ReactNode;
  accent?:  Accent;
  className?: string;
}

const accentBar: Record<Accent, string> = {
  none:     '',
  critical: 'before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-[--red]',
  warning:  'before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:bg-[--amb]',
};

const accentValue: Record<Accent, string> = {
  none:     'text-[--t0]',
  critical: 'text-[--red]',
  warning:  'text-[--amb]',
};

export const KPI = memo(function KPI({ label, value, sub, badge, accent = 'none', className }: KPIProps) {
  return (
    <div className={clsx(
      'relative bg-[--bg1] border border-[--line] p-[18px_16px_14px] overflow-hidden',
      'before:content-[""]',
      accentBar[accent],
      className,
    )}>
      <div className="flex items-start justify-between mb-[10px]">
        <span className="font-mono text-[9px] tracking-[2px] uppercase text-[--t2]">{label}</span>
        {badge && <span>{badge}</span>}
      </div>
      <div className={clsx('font-mono text-[24px] font-light leading-none mb-[5px] tracking-[-0.5px]', accentValue[accent])}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-[--t2] leading-[1.4]">{sub}</div>}
    </div>
  );
});
