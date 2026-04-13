import { clsx } from 'clsx';

type ValueStyle = 'default' | 'ok' | 'critical' | 'warning';

const valueStyles: Record<ValueStyle, string> = {
  default:  'text-[--t1]',
  ok:       'text-[--t0]',
  critical: 'text-[--red]',
  warning:  'text-[--amb]',
};

interface StatRowProps {
  label:      string;
  value:      string | number;
  valueStyle?: ValueStyle;
}

export function StatRow({ label, value, valueStyle = 'default' }: StatRowProps) {
  return (
    <div className="flex justify-between items-baseline py-[9px] border-b border-[--line] text-[11px] last:border-b-0">
      <span className="text-[--t2]">{label}</span>
      <span className={clsx('font-mono', valueStyles[valueStyle])}>{value}</span>
    </div>
  );
}
