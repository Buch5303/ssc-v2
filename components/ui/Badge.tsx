import { type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

type Variant = 'verified' | 'estimated' | 'critical' | 'warning' | 'pending' | 'silent';

const variants: Record<Variant, string> = {
  verified:  'border-[--edge]   text-[--t0]   bg-transparent',
  estimated: 'border-[--line]   text-[--t2]   bg-transparent',
  critical:  'border-[--red-bd] text-[--red]  bg-[--red-bg]',
  warning:   'border-[--amb-bd] text-[--amb]  bg-[--amb-bg]',
  pending:   'border-[--line]   text-[--t2]   bg-transparent',
  silent:    'border-[--line]   text-[--t3]   bg-transparent',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ variant = 'silent', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-mono text-[9px] font-normal tracking-[1px] uppercase',
        'px-[7px] py-[2px] rounded-[2px] border',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
