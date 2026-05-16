/**
 * Frontend mirror of `backend/schemas/routing.py`.
 *
 * The routing platform plans supplier → buyer product movements; this file is
 * the API contract the UI agent consumes. Field names use snake_case to match
 * the JSON shapes returned by `/api/routing/*` (Pydantic default), unlike the
 * camelCase license/maritime types — keep the boundary explicit so callers
 * never confuse the two.
 *
 * Connections to the rest of the platform:
 *   * `Supplier.origin_license_id` lines up with `MiningLicense.id` from the
 *     existing `/licenses` endpoint.
 *   * `RouteLeg.vessel_ref` lines up with `MaritimeVessel.mmsi` / `imo`
 *     returned by `/api/maritime/vessels`.
 *   * `LocationRef.locode` lines up with the UN/LOCODE values surfaced by
 *     `/api/logistics/ports` and `/api/storage/terminals`.
 */

export type ShippingMethod =
  | 'truck'
  | 'rail'
  | 'sea'
  | 'air'
  | 'pipeline'
  | 'inland_waterway'
  | 'multimodal';

export type RoutePlanStatus =
  | 'draft'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'cancelled';

/** Mirrors the existing `ShipmentStatus` union in `mining-viz/src/types`. */
export type RoutingShipmentStatus = 'planned' | 'in-transit' | 'delivered' | 'cancelled';

export type DueDiligenceState =
  | 'not_started'
  | 'pending'
  | 'passed'
  | 'flagged'
  | 'blocked'
  | 'expired';

export type RoutingPartyKind = 'supplier' | 'buyer' | 'carrier' | 'agent';

export type RoutingSector = 'mining' | 'oil_and_gas' | 'other';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface LocationRef {
  name: string;
  country?: string | null;
  country_iso2?: string | null;
  region?: string | null;
  /** UN/LOCODE for a port / inland point when known. */
  locode?: string | null;
  point?: GeoPoint | null;
  /** Foreign key into the existing licenses table when applicable. */
  license_id?: string | null;
  /** ID from `/api/logistics/ports`. */
  port_id?: string | null;
  /** ID from `/api/storage/terminals`. */
  storage_terminal_id?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface RoutingContactRef {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  entity_contact_id?: string | null;
}

export interface VesselRef {
  mmsi?: string | null;
  imo?: string | null;
  name?: string | null;
  flag?: string | null;
  last_observed_at?: string | null;
}

export interface CarrierRef {
  name: string;
  party_id?: string | null;
  contact?: RoutingContactRef | null;
  dd_status?: DueDiligenceStatus | null;
}

export interface DueDiligenceStatus {
  state: DueDiligenceState;
  /** Free-form e.g. 'low' | 'medium' | 'high'. */
  risk_level?: string | null;
  confidence?: number | null;
  summary?: string | null;
  findings: string[];
  blocking_findings: string[];
  sanctions_hits: string[];
  /** Pointer into the existing `dd_reports` table. */
  report_id?: string | null;
  last_checked_at?: string | null;
  expires_at?: string | null;
}

export interface RoutingSupplier {
  id: string;
  company: string;
  sector: RoutingSector;
  country?: string | null;
  country_iso2?: string | null;
  origin: LocationRef;
  origin_license_id?: string | null;
  contact?: RoutingContactRef | null;
  dd_status?: DueDiligenceStatus | null;
  metadata?: Record<string, unknown>;
}

export interface RoutingBuyer {
  id: string;
  company: string;
  country?: string | null;
  country_iso2?: string | null;
  destination: LocationRef;
  contact?: RoutingContactRef | null;
  dd_status?: DueDiligenceStatus | null;
  metadata?: Record<string, unknown>;
}

export interface RoutingProduct {
  sku?: string | null;
  name: string;
  sector: RoutingSector;
  commodity?: string | null;
  /** Lines up with `oil_trade_flows.hs_code` when applicable. */
  hs_code?: string | null;
  quantity?: number | null;
  /** Quantity unit; defaults to metric tonnes ('t') on the backend. */
  unit: string;
  grade?: string | null;
  packaging?: string | null;
  hazardous: boolean;
  value_usd?: number | null;
  metadata?: Record<string, unknown>;
}

export interface CostLine {
  label: string;
  /** e.g. 'transport' | 'customs' | 'insurance' | 'handling' | 'documentation' | 'storage'. */
  category: string;
  amount_usd: number;
  note?: string | null;
}

export interface CostBreakdown {
  currency: string;
  total_usd: number;
  lines: CostLine[];
  confidence?: number | null;
  estimated_at?: string | null;
  estimator?: string | null;
  notes?: string | null;
}

export interface RouteLeg {
  id: string;
  /** Position in the leg list; starts at 0. */
  sequence: number;
  method: ShippingMethod;
  from_node: LocationRef;
  to_node: LocationRef;
  distance_km?: number | null;
  est_duration_hours?: number | null;
  departure_eta?: string | null;
  arrival_eta?: string | null;
  carrier?: CarrierRef | null;
  /** Required when `method === 'sea'`; otherwise null. */
  vessel_ref?: VesselRef | null;
  country_crossings: string[];
  risk_factors: string[];
  est_cost?: CostBreakdown | null;
  metadata?: Record<string, unknown>;
}

export interface RoutePlan {
  id: string;
  status: RoutePlanStatus;
  supplier: RoutingSupplier;
  buyer: RoutingBuyer;
  product: RoutingProduct;
  legs: RouteLeg[];
  /** Incoterm 2020 code; matches the existing `deal_shipments.incoterm` column. */
  incoterm?: string | null;
  cost_breakdown?: CostBreakdown | null;
  dd_status?: DueDiligenceStatus | null;
  requested_departure?: string | null;
  requested_arrival?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RoutingShipment {
  id: string;
  plan_id: string;
  deal_id?: string | null;
  deal_label?: string | null;
  status: RoutingShipmentStatus;
  legs: RouteLeg[];
  actual_departure?: string | null;
  actual_arrival?: string | null;
  eta?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RoutePlanRequest {
  supplier?: RoutingSupplier | null;
  supplier_id?: string | null;
  buyer?: RoutingBuyer | null;
  buyer_id?: string | null;
  product: RoutingProduct;
  incoterm?: string | null;
  requested_departure?: string | null;
  requested_arrival?: string | null;
  preferred_methods?: ShippingMethod[];
  avoid_country_iso2?: string[];
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CostEstimateRequest {
  plan_id?: string | null;
  legs?: RouteLeg[] | null;
  product?: RoutingProduct | null;
  incoterm?: string | null;
}

export interface CostEstimateResponse {
  plan_id?: string | null;
  cost_breakdown: CostBreakdown;
  per_leg: CostBreakdown[];
  limitations: string[];
}

export interface ShippingMethodInfo {
  method: ShippingMethod;
  label: string;
  description: string;
  typical_speed_kmh?: number | null;
  /** Indicative USD per tonne-kilometre; null when too variable to quote. */
  typical_cost_usd_per_tkm?: number | null;
  requires_port: boolean;
  supports_hazardous: boolean;
  notes?: string | null;
}

export interface RoutePlanListItem {
  id: string;
  status: RoutePlanStatus;
  supplier_company: string;
  buyer_company: string;
  product_name: string;
  incoterm?: string | null;
  leg_count: number;
  total_distance_km?: number | null;
  total_cost_usd?: number | null;
  dd_state?: DueDiligenceState | null;
  created_at?: string | null;
}
