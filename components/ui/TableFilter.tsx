'use client';
import { useState, useCallback } from 'react';

interface FilterOption { label: string; value: string; }

interface TableFilterProps {
  placeholder?: string;
  filters?: { label: string; options: FilterOption[]; }[];
  onSearch: (q: string) => void;
  onFilter?: (key: string, val: string) => void;
  count?: number;
  total?: number;
}

export function TableFilter({ placeholder = 'Search…', filters, onSearch, onFilter, count, total }: TableFilterProps) {
  const [q, setQ] = useState('');

  const handleSearch = useCallback((v: string) => {
    setQ(v);
    onSearch(v);
  }, [onSearch]);

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="relative flex-1 max-w-[280px]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px]" style={{ color: 'var(--t3)' }}>⌕</span>
        <input
          type="text"
          value={q}
          onChange={e => handleSearch(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-7 pr-3 h-[30px] font-mono text-[11px] outline-none"
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--line)',
            color: 'var(--t0)',
            borderRadius: 0,
          }}
        />
      </div>
      {filters?.map(f => (
        <select
          key={f.label}
          onChange={e => onFilter?.(f.label, e.target.value)}
          className="h-[30px] px-2 font-mono text-[10px] outline-none"
          style={{ background: 'var(--bg2)', border: '1px solid var(--line)', color: 'var(--t2)', borderRadius: 0 }}
        >
          <option value="">All {f.label}</option>
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {count !== undefined && total !== undefined && (
        <span className="font-mono text-[9px] ml-auto" style={{ color: 'var(--t3)' }}>
          {count} / {total}
        </span>
      )}
    </div>
  );
}
