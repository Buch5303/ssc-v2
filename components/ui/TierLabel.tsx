export function TierLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[10px] mb-[16px]">
      <span className="font-mono text-[9px] tracking-[2.5px] uppercase text-[--t3] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[--line]" />
    </div>
  );
}
