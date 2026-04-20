import { clsx } from 'clsx';
import { memo } from 'react';

type Severity = 'critical' | 'warning' | 'resolved';

const styles: Record<Severity, { wrap: string; titleCls: string; borderL: string }> = {
  critical: {
    wrap:     'bg-[--red-bg] border border-[--red-bd]',
    titleCls: 'text-[#F4A0A0]',
    borderL:  'border-l-[3px] border-l-[--red]',
  },
  warning: {
    wrap:     'bg-[--amb-bg] border border-[--amb-bd]',
    titleCls: 'text-[#E8C080]',
    borderL:  'border-l-[3px] border-l-[--amb]',
  },
  resolved: {
    wrap:     'bg-[--bg2] border border-[--line]',
    titleCls: 'text-[--t2]',
    borderL:  'border-l-[3px] border-l-[--t3]',
  },
};

interface AlertCardProps {
  severity: Severity;
  title:    string;
  detail:   string;
  action?:  string;
  aside?:   React.ReactNode;
}

export const AlertCard = memo(function AlertCard({ severity, title, detail, action, aside }: AlertCardProps) {
  const s = styles[severity];
  return (
    <div className={clsx('flex items-start gap-3 px-[18px] py-[14px]', s.wrap, s.borderL)}>
      <div className="flex-1 min-w-0">
        <div className={clsx('text-[12px] font-semibold mb-[4px]', s.titleCls)}>{title}</div>
        <div className="text-[11px] text-[--t1] leading-[1.6]">{detail}</div>
        {action && (
          <div className="font-mono text-[9px] text-[--t3] mt-[6px] tracking-[0.3px]">{action}</div>
        )}
      </div>
      {aside && <div className="flex flex-col items-end gap-1 flex-shrink-0">{aside}</div>}
    </div>
  );
});
