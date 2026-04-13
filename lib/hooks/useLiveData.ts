'use client';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

export interface LiveData {
  source:    string;
  db_enabled:boolean;
  summary:   Record<string, unknown>;
  rfqs:      Record<string, unknown>;
  pricing:   Record<string, unknown>;
  contacts:  Record<string, unknown>;
  kpi:       Record<string, unknown>;
  computed: {
    responded: number; drafted: number;
    pipeline_value: number; days_to_send: number;
  };
  ts: string;
}

export function useLiveData() {
  const [isStale, setIsStale] = useState(false);
  const query = useQuery<LiveData>({
    queryKey:        ['live'],
    queryFn:         () => fetch('/api/live').then(r => r.json()),
    refetchInterval:  30_000,
    staleTime:        25_000,
  });
  useEffect(() => {
    if (!query.data?.ts) return;
    setIsStale(Date.now() - new Date(query.data.ts).getTime() > 120_000);
  }, [query.data?.ts]);
  return { ...query, isStale };
}

export function useHealthCheck() {
  return useQuery({
    queryKey:        ['health'],
    queryFn:         () => fetch('/api/health').then(r => r.json()),
    refetchInterval:  60_000,
    staleTime:        55_000,
  });
}
