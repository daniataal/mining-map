import { API_BASE } from './api';
import { fetchPlatformHealth, type PlatformHealthResponse } from './platformHealth';
import { getOilLiveSyncStatus, type OilLiveSyncStatus } from '../api/oilLiveApi';

export type AdminJobResult = {
  label: string;
  ok: boolean;
  at: string;
  payload?: unknown;
  error?: string;
};

export type LiveMapAdminSnapshot = {
  platform: PlatformHealthResponse | null;
  oilLive: OilLiveSyncStatus | null;
  maritime: Record<string, unknown> | null;
};

export async function fetchLiveMapAdminSnapshot(): Promise<LiveMapAdminSnapshot> {
  const [platform, oilLive, maritime] = await Promise.all([
    fetchPlatformHealth().catch(() => null),
    getOilLiveSyncStatus().catch(() => null),
    fetch(`${API_BASE}/api/maritime/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  return { platform, oilLive, maritime };
}

export async function postAdminJob(
  path: string,
  headers: HeadersInit,
  options?: { body?: unknown; query?: Record<string, string> },
): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: options?.body !== undefined ? JSON.stringify(options.body) : '{}',
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message?: unknown }).message)
        : typeof data === 'string'
          ? data
          : res.statusText;
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    (data as { status?: string }).status === 'error'
  ) {
    throw new Error(String((data as { message?: string }).message || 'Job failed'));
  }
  return data;
}
