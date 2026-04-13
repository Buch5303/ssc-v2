import { clsx } from 'clsx';

interface PanelProps {
  title:      string;
  meta?:      React.ReactNode;
  children:   React.ReactNode;
  flush?:     boolean;   // no padding on body
  className?: string;
}

export function Panel({ title, meta, children, flush, className }: PanelProps) {
  return (
    <div className={clsx('bg-[--bg1] border border-[--line] overflow-hidden', className)}>
      <div className="flex items-center justify-between px-[18px] py-[12px] border-b border-[--line] bg-[--bg2]">
        <span className="font-mono text-[9px] tracking-[2px] uppercase text-[--t2]">{title}</span>
        {meta && <div className="flex items-center gap-2">{meta}</div>}
      </div>
      <div className={flush ? '' : 'p-[18px]'}>{children}</div>
    </div>
  );
}
