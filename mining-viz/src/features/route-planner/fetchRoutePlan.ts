import { API_BASE } from '../../lib/api';
import type {
  CostLineItem,
  DueDiligenceCheck,
  DueDiligenceRecommendation,
  DueDiligenceStatus,
  RouteMapOverlay,
  RoutePlanOption,
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
  path?: [number, number][];
}

interface BackendRoutePlanSlice {
  id?: string;
  alternative_id?: string;
  label?: string;
  is_recommended?: boolean;
  route?: {
    origin?: BackendRoutePoint;
    destination?: BackendRoutePoint;
    legs?: BackendRouteLeg[];
  };
  cost_breakdown?: BackendRouteResponse['cost_breakdown'];
}

interface BackendRouteResponse {
  route?: {
    origin?: BackendRoutePoint;
    destination?: BackendRoutePoint;
    legs?: BackendRouteLeg[];
  };
  recommended?: BackendRoutePlanSlice;
  alternatives?: BackendRoutePlanSlice[];
  routing_context?: {
    inland_origin?: boolean;
    landlocked_hint?: string;
    alternatives_offered?: boolean;
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
  limitations?: string[];
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

function estimateCargoValue(productType: string, quantityTons: number): { valueUsd: number; note: string } {
  const normalized = productType.toLowerCase();
  const model = normalized.includes('gold_dore') || normalized.includes('bullion')
    ? {
        perTon: 132_000_000,
        note: 'Assumes 90% payable gold doré/bullion equivalent. Replace with assay, fineness, payable terms, and live fixing before execution.',
      }
    : normalized.includes('gold')
      ? {
          perTon: 2_800_000,
          note: 'Assumes high-grade gold concentrate at roughly 2% payable gold. Real value depends on assay, moisture, penalties, treatment charges, and payability.',
        }
      : normalized.includes('cobalt')
        ? { perTon: 35_000, note: 'Screening value for cobalt-bearing product; replace with assay and payable cobalt content.' }
        : normalized.includes('lithium')
          ? { perTon: 22_000, note: 'Screening value for lithium product; replace with product grade and index basis.' }
          : normalized.includes('copper')
            ? { perTon: 9_000, note: 'Uses rough copper metal benchmark basis; concentrate needs grade/payability/TC-RC terms.' }
            : normalized.includes('petroleum') || normalized.includes('oil')
              ? { perTon: 900, note: 'Uses rough refined/petroleum product per-ton screening basis; replace with Platts/Argus quote.' }
              : { perTon: 400, note: 'Generic bulk commodity screening value; replace with contract price.' };
  return {
    valueUsd: Math.max(0, Math.round(quantityTons * model.perTon)),
    note: model.note,
  };
}

function estimateCargoValueUsd(productType: string, quantityTons: number): number {
  return estimateCargoValue(productType, quantityTons).valueUsd;
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
      const backendPath = Array.isArray(leg.path)
        ? leg.path.filter((point): point is [number, number] =>
            Array.isArray(point) &&
            point.length === 2 &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1]),
          )
        : [];
      return {
        path: backendPath.length > 1 ? backendPath : ([[from.lat, from.lng], [to.lat, to.lng]] as [number, number][]),
        method: leg.method,
        label: `${titleCase(leg.method || 'transport')}: ${from.name} → ${to.name}`,
      };
    })
    .filter((leg): leg is { path: [number, number][]; method?: string; label?: string } => Boolean(leg));

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

function costBreakdownFromBackendSlice(
  costBreakdown: BackendRouteResponse['cost_breakdown'],
  routeLegs: BackendRouteLeg[],
): CostLineItem[] {
  const legCosts = costBreakdown?.leg_costs ?? [];
  const lines = legCosts.map((leg, index) => ({
    id: leg.leg_id || `leg-${index + 1}`,
    labelHe: `מקטע ${index + 1}: ${titleCase(leg.method || 'transport')}`,
    labelEn: `Leg ${index + 1}: ${titleCase(leg.method || 'transport')}`,
    amountUsd: Math.round(Number(leg.total_cost_usd) || 0),
    note: [
      `${Math.round(Number(leg.distance_km) || 0).toLocaleString()} ק"מ · ${routeLegs[index]?.from?.name || 'Origin'} ← ${routeLegs[index]?.to?.name || 'Destination'}`,
      `${Math.round(Number(leg.distance_km) || 0).toLocaleString()} km · ${routeLegs[index]?.from?.name || 'Origin'} → ${routeLegs[index]?.to?.name || 'Destination'}`,
    ] as [string, string],
  }));
  if (lines.length > 0) return lines;
  const total = Number(costBreakdown?.total_cost_usd) || 0;
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

function costBreakdownFromBackend(data: BackendRouteResponse): CostLineItem[] {
  return costBreakdownFromBackendSlice(data.cost_breakdown, data.route?.legs ?? []);
}

function planOptionFromBackendSlice(slice: BackendRoutePlanSlice): RoutePlanOption | null {
  const legs = slice.route?.legs ?? [];
  if (!legs.length) return null;
  const id = String(slice.id || slice.alternative_id || 'plan');
  const breakdown = costBreakdownFromBackendSlice(slice.cost_breakdown, legs);
  const totalCostUsd = breakdown.reduce((sum, line) => sum + line.amountUsd, 0);
  const labelEn = slice.label || id;
  return {
    id,
    label: labelEn,
    labelEn,
    labelHe: slice.label?.includes('Recommended') ? 'מומלץ' : `חלופה: ${labelEn}`,
    isRecommended: Boolean(slice.is_recommended),
    map: routeMapFromBackend({ route: slice.route }),
    breakdown,
    totalCostUsd,
  };
}

function routePlanOptionsFromBackend(data: BackendRouteResponse): {
  recommended: RoutePlanOption;
  alternatives: RoutePlanOption[];
} {
  const recommendedSlice = data.recommended ?? {
    id: 'recommended',
    label: 'Recommended',
    is_recommended: true,
    route: data.route,
    cost_breakdown: data.cost_breakdown,
  };
  const recommended =
    planOptionFromBackendSlice(recommendedSlice) ??
    planOptionFromBackendSlice({
      id: 'recommended',
      label: 'Recommended',
      is_recommended: true,
      route: data.route,
      cost_breakdown: data.cost_breakdown,
    });
  if (!recommended) {
    throw new Error('Route plan missing legs');
  }
  const alternatives = (data.alternatives ?? [])
    .map((slice) => planOptionFromBackendSlice(slice))
    .filter((opt): opt is RoutePlanOption => Boolean(opt));
  return { recommended, alternatives };
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
  const cargoValue = estimateCargoValue(payload.productType, payload.quantityTons);
  const { recommended, alternatives } = routePlanOptionsFromBackend(route);
  const freightTotal = recommended.totalCostUsd;
  const routeLimitations = Array.isArray(route.limitations) ? route.limitations : [];
  const landlockedHint = route.routing_context?.landlocked_hint;
  return {
    source: 'live',
    map: recommended.map,
    breakdown: recommended.breakdown,
    recommendedPlanId: recommended.id,
    routeAlternatives: alternatives,
    landlockedHint: landlockedHint || undefined,
    dueDiligence: ddSummary.checks,
    dueDiligenceRecommendation: ddSummary.recommendation,
    blockers: ddSummary.blockers,
    warnings: ddSummary.warnings,
    limitations: [...ddSummary.limitations, ...routeLimitations],
    routeAssumptions: [
      'Route is staged as inland transport to export gateway, trunk leg, then final delivery from import gateway.',
      'Gateway selection is nearest-hub screening logic, not a carrier booking.',
      alternatives.length > 0
        ? 'Compare route alternatives below (sea vs air or export ports); each is one sequential corridor.'
        : 'Single recommended corridor returned.',
      cargoValue.note,
    ],
    cargoValueUsd: cargoValue.valueUsd,
    cargoValueNote: cargoValue.note,
    freightToValuePct: cargoValue.valueUsd > 0 ? (freightTotal / cargoValue.valueUsd) * 100 : undefined,
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
    cargoValueUsd: estimateCargoValue(payload.productType, payload.quantityTons).valueUsd,
    cargoValueNote: estimateCargoValue(payload.productType, payload.quantityTons).note,
    limitations: [
      'Live routing or due-diligence endpoint unavailable; showing simulation only.',
      ...simulation.limitations,
    ],
  };
}
