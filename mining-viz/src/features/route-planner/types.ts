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
  fromName?: string;
  toName?: string;
  /** Hub kind at leg end (port, airport, rail_hub, …) from API. */
  toKind?: string;
  /** Short hub name for map labels (export port, airport, rail terminal). */
  hubLabel?: string;
  /** Backend geometry provider, e.g. osrm, searoute, corridor_fallback. */
  geometrySource?: string;
  /** One-line routing engine label from the API (e.g. Real road (OSRM)). */
  routingEngine?: string;
  /** Per-leg limitation bullets for the results panel. */
  limitations?: string[];
  /** Screening distance from backend when available. */
  distanceKm?: number;
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

export interface RouteMapEnd {
  lat: number;
  lng: number;
  label: string;
  role: 'supplier' | 'buyer';
}

/** Leaflet overlay payload (supplier / buyer rendered as origin/destination) */
export interface RouteMapOverlay {
  legs: RouteLeg[];
  waypoints: RouteWaypoint[];
  /** Panel supplier → buyer, independent of backend point names. */
  ends?: { from: RouteMapEnd; to: RouteMapEnd };
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
  /** Set when live routing failed and the UI fell back to simulation. */
  liveUnavailableReason?: string;
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

export interface RouteRiskFinding {
  code: string;
  severity: 'pass' | 'warn' | 'fail' | string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface RouteRiskAnalysis {
  score?: number;
  risk_level?: 'low' | 'medium' | 'high' | string;
  summary?: string;
  deterministic_warnings?: RouteRiskFinding[];
  recommendations?: string[];
  requires_human_review?: boolean;
  ai?: {
    status?: string | null;
    provider?: string | null;
    model?: string | null;
    bounded?: boolean;
  };
  token_saving?: Record<string, unknown>;
}

export interface AgentJobResponse<TOutput> {
  job_id: string;
  agent_type: string;
  status: 'running' | 'completed' | 'failed' | string;
  input_hash: string;
  entity_id?: string | null;
  route_hash?: string | null;
  output?: TOutput | null;
  error?: string | null;
  cached?: boolean;
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
