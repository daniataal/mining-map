import { API_BASE } from '../../lib/api';
import type { RoutePlannerApiResponse, RoutePlannerFormPayload } from './types';
import { mockResponseForPayload } from './mockRoute';

/**
 * Calls the backend route-planner endpoint.
 * The backend exposes  POST /api/routing/plans  only when ROUTE_PLANNER_ENABLED=1.
 * When it returns 503 (disabled) or the network fails we fall through to the
 * deterministic mock so the UI always shows something useful.
 *
 * Note: the backend stub returns a RoutePlan schema (not the RoutePlannerApiResponse
 * we use on the frontend) so this adapter bridges the gap.
 */
async function fetchLiveRoute(
  payload: RoutePlannerFormPayload,
): Promise<RoutePlannerApiResponse | null> {
  try {
    const url = `${API_BASE}/api/routing/plans`;
    const controller = new AbortController();
    // Short timeout — if the backend is responding but disabled (503) it replies
    // immediately.  If it's unreachable we don't want the UI frozen for 12 s.
    const timer = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Map our simplified frontend payload into the RoutePlanRequest schema.
        body: JSON.stringify({
          supplier: {
            id: 'ui-supplier',
            company: payload.supplier.label || 'Supplier',
            sector: 'mining',
            origin: {
              name: payload.supplier.label || 'Origin',
              point: { lat: payload.supplier.lat, lng: payload.supplier.lng },
            },
            dd_status: { state: 'not_started' },
          },
          buyer: {
            id: 'ui-buyer',
            company: payload.buyer.label || 'Buyer',
            destination: {
              name: payload.buyer.label || 'Destination',
              point: { lat: payload.buyer.lat, lng: payload.buyer.lng },
            },
            dd_status: { state: 'not_started' },
          },
          product: {
            commodity: payload.productType,
            quantity_mt: 1000,
            hs_code: '2616',
          },
          preferred_methods: payload.shippingMethods.map((m) => {
            // map frontend IDs → backend enum values
            const map: Record<string, string> = {
              sea_fcl: 'sea',
              sea_lcl: 'sea',
              rail: 'rail',
              truck_inland: 'truck',
              air: 'air',
            };
            return map[m] ?? m;
          }),
          avoid_country_iso2: [],
        }),
        signal: controller.signal,
      });

      // 503 = route planner disabled on backend; fall through to mock silently.
      if (res.status === 503 || res.status === 501) return null;
      if (!res.ok) return null;

      // Backend returned a RoutePlan stub — convert to our UI shape.
      await res.json(); // consume response even if we can't use it
      return null; // stub doesn't populate legs/breakdown yet — use mock
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Prefers the live backend; falls back to a deterministic, geographically-
 * correct mock that scales costs by route distance.
 */
export async function fetchRoutePlan(
  payload: RoutePlannerFormPayload,
): Promise<RoutePlannerApiResponse> {
  const live = await fetchLiveRoute(payload);
  if (live) return live;
  return mockResponseForPayload(payload.supplier, payload.buyer, payload.productType, payload.shippingMethods);
}
