import { clsx } from 'clsx';

type State = 'critical' | 'warning' | 'mono';

const stateStyle: Record<State, { wrap: string; tagCls: string; tagBorder: string }> = {
  critical: {
    wrap:      'bg-[--red-bg] border-b border-[--red-bd]',
    tagCls:    'text-[--red]',
    tagBorder: 'border-r border-[--red-bd]',
  },
  warning: {
    wrap:      'bg-[--amb-bg] border-b border-[--amb-bd]',
    tagCls:    'text-[--amb]',
    tagBorder: 'border-r border-[--amb-bd]',
  },
  mono: {
    wrap:      'bg-[--bg1] border-b border-[--line]',
    tagCls:    'text-[--t2]',
    tagBorder: 'border-r border-[--line]',
  },
};

interface CondItem { label: string; value: string; isAction?: boolean }

interface ConditionBannerProps {
  state:  State;
  tag:    string;
  items:  CondItem[];
}

export function ConditionBanner({ state, tag, items }: ConditionBannerProps) {
  const s = stateStyle[state];
  return (
    <div className={clsx('flex items-center min-h-[38px] px-6', s.wrap)}>
      <span className={clsx('font-mono text-[9px] tracking-[1.8px] uppercase pr-3 mr-[14px] font-medium', s.tagCls, s.tagBorder)}>
        {tag}
      </span>
      <div className="flex flex-1 overflow-hidden">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-4 border-r border-[--line] text-[11px] last:border-r-0 flex-shrink-0">
            <span className="text-[--t2]">{item.label}</span>
            <span className={clsx('font-medium', item.isAction ? stateStyle[state].tagCls : 'text-[--t0]')}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
