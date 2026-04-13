/**
 * FlowSeer Production API Client
 * Reads from:
 *   1. Next.js API routes (/api/...) — proxies to backend or reads from data files
 *   2. Falls back to GitHub raw JSON for resilience
 */

const API_BASE  = process.env.NEXT_PUBLIC_API_URL  || '';
const GH_RAW    = 'https://raw.githubusercontent.com/Buch5303/ssc-v2/frontend-only/tools/dashboard/data';

/** Primary fetch — Next.js API routes */
export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${API_BASE}/api${path}`;
  const res = await fetch(url, {
    next: { revalidate: 60 },   // ISR — refresh every 60s
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** Direct GitHub fetch — used as fallback and for live data files */
export async function ghFetch<T>(filename: string): Promise<T> {
  const ts  = Math.floor(Date.now() / 60000); // 1-min cache buster
  const url = `${GH_RAW}/${filename}?_=${ts}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`GH ${filename} → ${res.status}`);
  return res.json() as Promise<T>;
}
