const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const url = `${API_BASE}/api${path}`;
  const res = await fetch(url, { cache: 'no-store', ...opts });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
