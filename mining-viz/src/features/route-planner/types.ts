export type RouteWaypointRole = 'origin' | 'destination' | 'transit';

export interface RouteWaypoint {
  lat: number;
  lng: number;
  role: RouteWaypointRole;
  /** i18n: Hebrew first (hook usage) */
  label: [string, string];
}

export interface RouteLeg {
  path: [number, number][];
  method?: 'sea' | 'road' | 'rail' | 'air' | 'pipeline' | string;
  label?: string;
}

export interface CostLineItem {
  id: string;
  labelHe: string;
  labelEn: string;
  amountUsd: number;
  note?: [string, string];
}

export type DueDiligenceStatus = 'pass' | 'warn' | 'fail';
export type RoutePlannerSource = 'live' | 'simulation';
export type DueDiligenceRecommendation = 'approve' | 'escalate' | 'block';

export interface DueDiligenceCheck {
  id: string;
  labelHe: string;
  labelEn: string;
  status: DueDiligenceStatus;
  detail?: [string, string];
}

/** Leaflet overlay payload (supplier / buyer rendered as origin/destination) */
export interface RouteMapOverlay {
  legs: RouteLeg[];
  waypoints: RouteWaypoint[];
}

/** One full sequential route plan (recommended or alternative). */
export interface RoutePlanOption {
  id: string;
  label: string;
  labelHe?: string;
  labelEn?: string;
  isRecommended: boolean;
  map: RouteMapOverlay;
  breakdown: CostLineItem[];
  totalCostUsd: number;
}

export interface RoutePlannerApiResponse {
  source: RoutePlannerSource;
  map: RouteMapOverlay;
  breakdown: CostLineItem[];
  dueDiligence: DueDiligenceCheck[];
  limitations: string[];
  routeAssumptions?: string[];
  cargoValueUsd?: number;
  cargoValueNote?: string;
  freightToValuePct?: number;
  dueDiligenceRecommendation: DueDiligenceRecommendation;
  blockers: string[];
  warnings: string[];
  /** Recommended plan id (matches selected alternative when set). */
  recommendedPlanId?: string;
  /** Additional full-route options (sea vs air, second export port, etc.). */
  routeAlternatives?: RoutePlanOption[];
  /** Shown for inland / landlocked origins when the API offers multiple export paths. */
  landlockedHint?: string;
}

export interface RoutePlannerFormPayload {
  supplier: {
    lat: number;
    lng: number;
    label: string;
    country?: string;
    licenseId?: string;
    commodity?: string;
    sector?: string;
  };
  buyer: { lat: number; lng: number; label: string; country?: string };
  productType: string;
  shippingMethods: string[];
  quantityTons: number;
  incoterm: string;
}
