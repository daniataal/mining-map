import { API_BASE } from '../../lib/api';
import type {
  CostLineItem,
  DueDiligenceCheck,
  DueDiligenceRecommendation,
  DueDiligenceStatus,
  RouteMapOverlay,
  RoutePlannerApiResponse,
  RoutePlannerFormPayload,
} from './types';
import { mockResponseForPayload } from './mockRoute';

type BackendMethod = 'sea' | 'road' | 'rail' | 'air' | 'pipeline';

interface BackendRoutePoint {
  name?: string;
  lat?: number;
  lng?: number;
  kind?: string;
}

interface BackendRouteLeg {
  leg_id?: string;
  from?: BackendRoutePoint;
  to?: BackendRoutePoint;
  method?: BackendMethod | string;
  distance_km?: number;
}

interface BackendRouteResponse {
  route?: {
    origin?: BackendRoutePoint;
    destination?: BackendRoutePoint;
    legs?: BackendRouteLeg[];
  };
  cost_breakdown?: {
    total_cost_usd?: number;
    total_distance_km?: number;
    leg_costs?: Array<{
      leg_id?: string;
      method?: string;
      distance_km?: number;
      total_cost_usd?: number;
      components?: Array<{ component?: string; amount_usd?: number; formula?: string }>;
    }>;
  };
}

interface DdApiResponse {
  checks?: Array<{
    check_id?: string;
    dimension?: string;
    verdict?: 'pass' | 'warn' | 'fail';
    message?: string;
  }>;
  blockers?: string[];
  recommendation?: DueDiligenceRecommendation;
  overall_score?: number;
  license_check_performed?: boolean;
}

function backendMethod(method: string): BackendMethod {
  const map: Record<string, BackendMethod> = {
    sea_fcl: 'sea',
    sea_lcl: 'sea',
    truck_inland: 'road',
    rail: 'rail',
    air: 'air',
    pipeline: 'pipeline',
  };
  return map[method] ?? 'road';
}

function productKind(productType: string): string {
  const normalized = productType.toLowerCase();
  if (normalized.includes('petroleum') || normalized.includes('oil')) return 'petroleum';
  if (normalized.includes('gas') || normalized.includes('lng') || normalized.includes('lpg')) return 'gas';
  if (normalized.includes('gold')) return 'gold';
  return productType;
}

function estimateCargoValueUsd(productType: string, quantityTons: number): number {
  const normalized = productType.toLowerCase();
  const perTon = normalized.includes('gold')
    ? 2_800_000
    : normalized.includes('cobalt') || normalized.includes('lithium')
      ? 35_000
      : normalized.includes('petroleum') || normalized.includes('oil')
        ? 900
        : 400;
  return Math.max(0, Math.round(quantityTons * perTon));
}

function pointOrNull(point: BackendRoutePoint | undefined): { lat: number; lng: number; name: string } | null {
  if (!point || point.lat == null || point.lng == null) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return {
    lat: point.lat,
    lng: point.lng,
    name: point.name || point.kind || 'Route point',
  };
}

function routeMapFromBackend(data: BackendRouteResponse): RouteMapOverlay {
  const legs = data.route?.legs ?? [];
  const overlayLegs = legs
    .map((leg) => {
      const from = pointOrNull(leg.from);
      const to = pointOrNull(leg.to);
      if (!from || !to) return null;
      return { path: [[from.lat, from.lng], [to.lat, to.lng]] as [number, number][] };
    })
    .filter((leg): leg is { path: [number, number][] } => Boolean(leg));

  const waypoints: RouteMapOverlay['waypoints'] = [];
  const origin = pointOrNull(data.route?.origin ?? legs[0]?.from);
  const destination = pointOrNull(data.route?.destination ?? legs[legs.length - 1]?.to);
  if (origin) {
    waypoints.push({
      lat: origin.lat,
      lng: origin.lng,
      role: 'origin',
      label: ['ספק (מוצא)', origin.name],
    });
  }
  for (const leg of legs.slice(0, -1)) {
    const transit = pointOrNull(leg.to);
    if (!transit) continue;
    waypoints.push({
      lat: transit.lat,
      lng: transit.lng,
      role: 'transit',
      label: ['נקודת מעבר', transit.name],
    });
  }
  if (destination) {
    waypoints.push({
      lat: destination.lat,
      lng: destination.lng,
      role: 'destination',
      label: ['קונה / יעד', destination.name],
    });
  }
  return { legs: overlayLegs, waypoints };
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function costBreakdownFromBackend(data: BackendRouteResponse): CostLineItem[] {
  const legCosts = data.cost_breakdown?.leg_costs ?? [];
  const lines = legCosts.map((leg, index) => ({
    id: leg.leg_id || `leg-${index + 1}`,
    labelHe: `מקטע ${index + 1}: ${titleCase(leg.method || 'transport')}`,
    labelEn: `Leg ${index + 1}: ${titleCase(leg.method || 'transport')}`,
    amountUsd: Math.round(Number(leg.total_cost_usd) || 0),
    note: [
      `${Math.round(Number(leg.distance_km) || 0).toLocaleString()} ק"מ`,
      `${Math.round(Number(leg.distance_km) || 0).toLocaleString()} km estimated distance`,
    ] as [string, string],
  }));
  if (lines.length > 0) return lines;
  const total = Number(data.cost_breakdown?.total_cost_usd) || 0;
  return [
    {
      id: 'route_total',
      labelHe: 'אומדן מסלול חי',
      labelEn: 'Live route estimate',
      amountUsd: Math.round(total),
      note: ['מחושב משירות המסלול', 'Calculated by the route service'],
    },
  ];
}

function ddStatus(verdict: string | undefined): DueDiligenceStatus {
  if (verdict === 'fail') return 'fail';
  if (verdict === 'warn') return 'warn';
  return 'pass';
}

function dueDiligenceFromBackend(data: DdApiResponse | null): {
  checks: DueDiligenceCheck[];
  recommendation: DueDiligenceRecommendation;
  blockers: string[];
  warnings: string[];
  limitations: string[];
} {
  if (!data) {
    return {
      checks: [
        {
          id: 'dd-unavailable',
          labelHe: 'בדיקת נאותות לא זמינה',
          labelEn: 'Due diligence unavailable',
          status: 'warn',
          detail: ['חייבים להריץ בדיקה חיה לפני ביצוע.', 'Run live checks before execution.'],
        },
      ],
      recommendation: 'escalate',
      blockers: [],
      warnings: ['Due-diligence service unavailable.'],
      limitations: ['Live route worked, but the due-diligence service did not respond.'],
    };
  }

  const checks = (data.checks ?? []).map((check, index) => ({
    id: check.check_id || `dd-${index + 1}`,
    labelHe: titleCase(check.dimension || 'check'),
    labelEn: titleCase(check.dimension || 'check'),
    status: ddStatus(check.verdict),
    detail: [check.message || '', check.message || ''] as [string, string],
  }));
  const warnings = (data.checks ?? [])
    .filter((check) => check.verdict === 'warn')
    .map((check) => check.message || check.dimension || 'Warning');
  return {
    checks,
    recommendation: data.recommendation || 'escalate',
    blockers: data.blockers ?? [],
    warnings,
    limitations: data.license_check_performed ? [] : ['License check degraded: no database license lookup was performed.'],
  };
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchDueDiligence(payload: RoutePlannerFormPayload): Promise<DdApiResponse | null> {
  try {
    const supplierCountry = payload.supplier.country || '';
    const buyerCountry = payload.buyer.country || '';
    if (!supplierCountry && !buyerCountry) return null;
    return await postJson<DdApiResponse>(
      `${API_BASE}/api/routing/due-diligence`,
      {
        supplier_country: supplierCountry || 'Unknown',
        buyer_country: buyerCountry || 'Unknown',
        product_type: productKind(payload.productType),
        commodity: payload.supplier.commodity || payload.productType,
        license_ids: payload.supplier.licenseId ? [payload.supplier.licenseId] : undefined,
        quantity_tons: payload.quantityTons,
        estimated_value_usd: estimateCargoValueUsd(payload.productType, payload.quantityTons),
        supplier_entity_name: payload.supplier.label || undefined,
        buyer_entity_name: payload.buyer.label || undefined,
      },
      10_000,
    );
  } catch {
    return null;
  }
}

async function fetchLiveRoute(payload: RoutePlannerFormPayload): Promise<RoutePlannerApiResponse | null> {
  const normalizedProduct = payload.productType.toLowerCase();
  const route = await postJson<BackendRouteResponse>(
    `${API_BASE}/api/logistics/route-plan`,
    {
      product: payload.productType,
      quantity_tons: payload.quantityTons,
      origin: {
        name: payload.supplier.label || 'Supplier',
        lat: payload.supplier.lat,
        lng: payload.supplier.lng,
        kind: payload.supplier.sector === 'oil_and_gas' ? 'terminal' : 'origin',
        metadata: {
          country: payload.supplier.country,
          license_id: payload.supplier.licenseId,
          commodity: payload.supplier.commodity,
          sector: payload.supplier.sector,
        },
      },
      destination: {
        name: payload.buyer.label || 'Destination',
        lat: payload.buyer.lat,
        lng: payload.buyer.lng,
        kind: 'destination',
        metadata: { country: payload.buyer.country },
      },
      transit_points: [],
      preferred_methods: Array.from(new Set(payload.shippingMethods.map(backendMethod))),
      pipeline_layer_enabled:
        normalizedProduct.includes('petroleum') ||
        normalizedProduct.includes('oil') ||
        normalizedProduct.includes('gas') ||
        normalizedProduct.includes('lng') ||
        normalizedProduct.includes('lpg'),
    },
    12_000,
  );

  const dd = await fetchDueDiligence(payload);
  const ddSummary = dueDiligenceFromBackend(dd);
  return {
    source: 'live',
    map: routeMapFromBackend(route),
    breakdown: costBreakdownFromBackend(route),
    dueDiligence: ddSummary.checks,
    dueDiligenceRecommendation: ddSummary.recommendation,
    blockers: ddSummary.blockers,
    warnings: ddSummary.warnings,
    limitations: ddSummary.limitations,
  };
}

export async function fetchRoutePlan(payload: RoutePlannerFormPayload): Promise<RoutePlannerApiResponse> {
  try {
    const live = await fetchLiveRoute(payload);
    if (live && live.map.legs.length > 0) return live;
  } catch {
    // Fallback below is intentionally explicit in the returned payload.
  }
  const simulation = mockResponseForPayload(
    payload.supplier,
    payload.buyer,
    payload.productType,
    payload.shippingMethods,
  );
  return {
    ...simulation,
    limitations: [
      'Live routing or due-diligence endpoint unavailable; showing simulation only.',
      ...simulation.limitations,
    ],
  };
}
