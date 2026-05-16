import { API_BASE } from '../../lib/api';
import type { RoutePlannerApiResponse, RoutePlannerFormPayload } from './types';
import { mockResponseForPayload } from './mockRoute';

function isPlannerResponse(body: unknown): body is RoutePlannerApiResponse {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const map = b.map as Record<string, unknown> | undefined;
  return (
    Array.isArray(map?.legs) &&
    Array.isArray(map?.waypoints) &&
    Array.isArray(b.breakdown) &&
    Array.isArray(b.dueDiligence)
  );
}

async function fetchLiveRoute(payload: RoutePlannerFormPayload): Promise<RoutePlannerApiResponse | null> {
  try {
    const url = `${API_BASE}/api/route-planner`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as unknown;
      if (!isPlannerResponse(data)) return null;
      return { ...data, source: 'live' };
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Prefer POST /api/route-planner when the backend exposes it; otherwise deterministic mock.
 */
export async function fetchRoutePlan(payload: RoutePlannerFormPayload): Promise<RoutePlannerApiResponse> {
  const live = await fetchLiveRoute(payload);
  if (live) return live;
  return mockResponseForPayload(payload.supplier, payload.buyer);
}
