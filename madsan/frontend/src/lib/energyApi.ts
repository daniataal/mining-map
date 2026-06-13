import type { FeatureCollection } from "geojson";
import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

export type ShipvaultFleetVessel = {
  name?: string;
  imo?: string;
  mmsi?: string;
  dwt?: number;
  gt?: number;
  type?: string;
  built_year?: number;
  flag?: string;
  shipvault_vessel_id?: string;
};

export type ShipvaultCompany = {
  shipvault_company_id: string;
  name: string;
  country?: string;
  city?: string;
  fleet_size?: number;
  total_dwt?: number;
  total_gt?: number;
  avg_age_years?: number;
  fleet_list?: ShipvaultFleetVessel[];
  madsan_company_id?: string;
  tier?: string;
  fetched_at?: string;
  stale_after?: string;
};

export type PortCallRecord = {
  terminal_name?: string;
  country?: string;
  event_type?: string;
  commodity_family?: string;
  arrival_ts?: string;
  departure_ts?: string;
  confidence_score?: number;
  tier: string;
  source: string;
  status?: string;
};

export type UnknownSupplierLead = {
  country_code?: string;
  commodity?: string;
  asset_count?: number;
  gap_score?: number;
  corridor_label?: string;
  message?: string;
};

export type MCRScaffoldStatus = {
  tier: string;
  status: string;
  message: string;
  limitations?: string[];
};

export type IntelOpportunity = {
  id: string;
  opportunity_type?: string;
  commodity?: string;
  origin_country?: string;
  destination_country?: string;
  supplier_company_id?: string;
  buyer_company_id?: string;
  supplier_asset_id?: string;
  buyer_asset_id?: string;
  vessel_id?: string;
  lane_id?: string;
  score?: number;
  confidence_score?: number;
  evidence_grade?: string;
  score_breakdown?: {
    supplier_reality?: number;
    buyer_reality?: number;
    market_pressure?: number;
    route_feasibility?: number;
    price_context?: number;
    investor_control?: number;
    risk_discount?: number;
  };
  route_summary?: Record<string, unknown>;
  cargo_summary?: Record<string, unknown>;
  market_pressure_summary?: Record<string, unknown>;
  price_context?: Record<string, unknown>;
  evidence?: Array<Record<string, unknown>>;
  limitations?: string[];
  tier?: string;
  generated_at?: string;
  expires_at?: string;
};

export type IntelCargoMovement = {
  id: string;
  source?: string;
  vessel_id?: string;
  vessel_name?: string;
  imo?: string;
  mmsi?: string;
  vessel_class?: string;
  owner_name?: string;
  operator_name?: string;
  product_family?: string;
  load?: { port?: string; country?: string };
  discharge?: { port?: string; country?: string };
  quantity?: { low?: number; best?: number; high?: number; unit?: string; method?: string };
  confidence?: number;
  observed_at?: string;
  evidence_label?: string;
};

export type IntelSTSPrediction = {
  id: string;
  signal_type?: string;
  confidence_score?: number;
  horizon_hours?: number;
  payload?: Record<string, unknown>;
  predicted_at?: string;
  expires_at?: string;
  evidence_label?: string;
};

export type IntelArbitrage = {
  origin?: string;
  destination?: string;
  commodity?: string;
  benchmarks?: Array<Record<string, unknown>>;
  landed_margin?: Record<string, unknown>;
  limitations?: string[];
};

export type IntelImporter = {
  company_id?: string;
  name?: string;
  product_code?: string;
  product_name?: string;
  origin_country?: { country_code?: string };
  quantity?: { value?: number; unit?: string };
  rows?: number;
  latest_month?: string;
  port_count?: number;
  port_states?: string[];
  evidence_label?: string;
  source?: string;
};

export type IntelInvestorPath = {
  id: string;
  opportunity_id?: string;
  lane_id?: string;
  commodity?: string;
  origin_country?: string;
  destination_country?: string;
  score?: number;
  confidence_score?: number;
  investor_control_score?: number;
  evidence_grade?: string;
  evidence_label?: string;
  investor?: {
    entity_id?: string;
    name?: string;
    exposure_role?: string;
    exposure_count?: number;
    exposure_value?: number;
    exposure_unit?: string;
    exposure_types?: string[];
    confidence_score?: number;
  };
  commercial_thesis?: string;
  supplier?: Record<string, unknown>;
  buyer?: Record<string, unknown>;
  route?: Record<string, unknown>;
  market?: Record<string, unknown>;
  cargo?: Record<string, unknown>;
  price_context?: Record<string, unknown>;
  exposures?: Array<Record<string, unknown>>;
  control_chain?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  limitations?: string[];
  generated_at?: string;
};

export async function fetchShipvaultCompany(companyId: string): Promise<ShipvaultCompany | null> {
  const res = await fetch(`${API_BASE}/api/energy/shipvault/companies/${encodeURIComponent(companyId)}`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<ShipvaultCompany>;
}

export async function fetchVesselPortCalls(mmsi: string, limit = 20): Promise<PortCallRecord[]> {
  const res = await fetch(
    `${API_BASE}/api/energy/vessels/by-mmsi/${encodeURIComponent(mmsi)}/port-calls?limit=${limit}`,
    authFetchOpts,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { port_calls?: PortCallRecord[] };
  return data.port_calls ?? [];
}

export async function fetchVesselTrack(mmsi: string, hours = 24): Promise<FeatureCollection> {
  const res = await fetch(
    `${API_BASE}/api/energy/vessels/by-mmsi/${encodeURIComponent(mmsi)}/track?hours=${hours}`,
    authFetchOpts,
  );
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection>;
}

export async function fetchSTSEvents(bbox?: string): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : "";
  const res = await fetch(`${API_BASE}/api/energy/sts/events${q}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type STSSummary = {
  events_24h?: number;
  events_7d?: number;
  events_total?: number;
  events_unscored?: number;
  predictions_active?: number;
  last_observed_at?: string | null;
};

export async function fetchSTSSummary(): Promise<STSSummary | null> {
  const res = await fetch(`${API_BASE}/api/energy/sts/summary`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<STSSummary>;
}

export async function fetchSTSPredictions(
  bbox?: string,
  horizon = 24,
): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ horizon: String(horizon) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/sts/predictions?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type NearestGemPipelineHit = {
  found: boolean;
  segment_key?: string;
  project_id?: string;
  distance_m?: number;
  distance_km?: number;
  tags?: Record<string, unknown>;
  source_id?: string;
  attribution?: string;
  asset_id?: string;
};

export async function fetchNearestGemPipeline(
  lat: number,
  lng: number,
  maxM = 2000,
): Promise<NearestGemPipelineHit> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    max_m: String(maxM),
  });
  const res = await fetch(`${API_BASE}/api/energy/pipelines/nearest-gem?${params}`, authFetchOpts);
  if (!res.ok) return { found: false };
  return (await res.json()) as NearestGemPipelineHit;
}

export type PipelineSnappedAsset = {
  id: string;
  name: string;
  asset_type: string;
  distance_m?: number;
  confidence_score?: number;
  tier?: string;
};

export type PipelineConnectivity = {
  pipeline_id: string;
  osm_id?: string;
  legacy_id?: string;
  name?: string;
  tier?: string;
  method?: string;
  endpoints: {
    start: {
      point: { latitude: number; longitude: number };
      snapped_asset?: PipelineSnappedAsset;
    };
    end: {
      point: { latitude: number; longitude: number };
      snapped_asset?: PipelineSnappedAsset;
    };
  };
  upstream?: unknown[];
  downstream?: unknown[];
  limitations?: string[];
};

export async function fetchPipelineConnectivity(pipelineId: string): Promise<PipelineConnectivity | null> {
  const res = await fetch(
    `${API_BASE}/api/energy/pipelines/${encodeURIComponent(pipelineId)}/connectivity`,
    authFetchOpts,
  );
  if (!res.ok) return null;
  return (await res.json()) as PipelineConnectivity;
}

export type PipelineMapFocus = {
  osmId?: string;
  legacyRowId?: string;
  assetId?: string;
  connectedAssetIds: string[];
  overlay: FeatureCollection;
} | null;

export function pipelineFocusFromSelection(selection?: {
  _layer?: string;
  osm_id?: string;
  legacy_row_id?: string;
  id?: string;
} | null): PipelineMapFocus {
  if (!selection || selection._layer !== "pipelines") return null;
  const osmId = selection.osm_id ? String(selection.osm_id) : undefined;
  const legacyRowId = selection.legacy_row_id ? String(selection.legacy_row_id) : undefined;
  const assetId = selection.id ? String(selection.id) : undefined;
  if (!osmId && !legacyRowId && !assetId) return null;
  return {
    osmId,
    legacyRowId,
    assetId,
    connectedAssetIds: [],
    overlay: { type: "FeatureCollection", features: [] },
  };
}

export function buildPipelineMapFocus(
  conn: PipelineConnectivity,
  selection?: { osm_id?: string; legacy_row_id?: string; id?: string },
): PipelineMapFocus {
  const connectedAssetIds: string[] = [];
  const features: FeatureCollection["features"] = [];
  for (const [label, ep] of [
    ["Start", conn.endpoints?.start],
    ["End", conn.endpoints?.end],
  ] as const) {
    if (!ep?.point) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ep.point.longitude, ep.point.latitude] },
      properties: { kind: "endpoint", label },
    });
    if (ep.snapped_asset?.id) {
      connectedAssetIds.push(ep.snapped_asset.id);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [ep.point.longitude, ep.point.latitude] },
        properties: {
          kind: "facility",
          label: ep.snapped_asset.name,
          asset_type: ep.snapped_asset.asset_type,
          asset_id: ep.snapped_asset.id,
        },
      });
    }
  }
  return {
    osmId: selection?.osm_id ?? conn.osm_id,
    legacyRowId: selection?.legacy_row_id ?? conn.legacy_id,
    assetId: selection?.id,
    connectedAssetIds,
    overlay: { type: "FeatureCollection", features },
  };
}

/** Keep map-click ids when connectivity enrichment arrives (or fails). */
export function mergePipelineFocus(
  base: PipelineMapFocus,
  fromConnectivity: PipelineMapFocus | null | undefined,
): PipelineMapFocus {
  if (!base) return fromConnectivity ?? null;
  if (!fromConnectivity) return base;
  return {
    osmId: base.osmId ?? fromConnectivity.osmId,
    legacyRowId: base.legacyRowId ?? fromConnectivity.legacyRowId,
    assetId: base.assetId ?? fromConnectivity.assetId,
    connectedAssetIds: fromConnectivity.connectedAssetIds,
    overlay:
      fromConnectivity.overlay.features.length > 0 ? fromConnectivity.overlay : base.overlay,
  };
}

export async function fetchBunkerSuppliers(): Promise<{
  hubs: Array<{
    hub_key: string;
    port_name: string;
    locode?: string;
    country_code?: string;
    license_authority?: string;
    register_tier?: string;
    suppliers: Array<{
      id: string;
      name: string;
      phone?: string;
      email?: string;
      products?: string[];
      fuels_supplied?: string;
      source_url?: string;
      confidence_score?: number;
    }>;
  }>;
  supplier_count?: number;
  disclaimer?: string;
}> {
  const res = await fetch(`${API_BASE}/api/energy/bunker/suppliers`, authFetchOpts);
  if (!res.ok) return { hubs: [] };
  return res.json();
}

export async function fetchStorageSites(bbox?: string): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ limit: "1500" });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/storage/sites?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type StorageSummary = {
  sites?: number;
  tanks?: number;
  inventory_bbl_low?: number;
  inventory_bbl_high?: number;
  us_crude_stock_trend?: {
    latest_kbbl?: number;
    period?: string;
    direction?: string;
    weekly_delta_kbbl?: number;
  };
};

export async function fetchStorageSummary(): Promise<StorageSummary | null> {
  const res = await fetch(`${API_BASE}/api/energy/storage/summary`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<StorageSummary>;
}

export async function fetchMCRCorridors(bbox?: string, limit = 300): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/mcr/corridors?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export async function fetchAssetGeometries(
  bbox?: string,
  limit = 500,
): Promise<FeatureCollection & { count?: number; simplified?: boolean; message?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/intel/asset-geometries?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { count?: number; simplified?: boolean; message?: string }>;
}

export async function fetchUnknownSupplierLeads(limit = 12): Promise<UnknownSupplierLead[]> {
  const res = await fetch(`${API_BASE}/api/energy/leads/unknown-suppliers?limit=${limit}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { leads?: UnknownSupplierLead[] };
  return data.leads ?? [];
}

export async function fetchMCRStatus(): Promise<MCRScaffoldStatus | null> {
  const res = await fetch(`${API_BASE}/api/energy/mcr/scaffold/status`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<MCRScaffoldStatus>;
}

export async function fetchIntelOpportunities(params?: {
  commodity?: string;
  origin?: string;
  destination?: string;
  minScore?: number;
  role?: string;
  limit?: number;
}): Promise<IntelOpportunity[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 25) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.destination) q.set("destination", params.destination);
  if (params?.minScore != null) q.set("min_score", String(params.minScore));
  if (params?.role) q.set("role", params.role);
  const res = await fetch(`${API_BASE}/api/intel/opportunities?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelOpportunity[] };
  return data.items ?? [];
}

export async function fetchIntelCargoMovements(params?: {
  commodity?: string;
  country?: string;
  limit?: number;
}): Promise<IntelCargoMovement[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.country) q.set("country", params.country);
  const res = await fetch(`${API_BASE}/api/intel/cargo-movements?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelCargoMovement[] };
  return data.items ?? [];
}

export async function fetchIntelSTSPredictions(limit = 12): Promise<IntelSTSPrediction[]> {
  const res = await fetch(`${API_BASE}/api/intel/sts-predictions?limit=${limit}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelSTSPrediction[] };
  return data.items ?? [];
}

export async function fetchIntelImporters(params?: {
  commodity?: string;
  origin?: string;
  company?: string;
  limit?: number;
}): Promise<IntelImporter[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.company) q.set("company", params.company);
  const res = await fetch(`${API_BASE}/api/intel/importers?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelImporter[] };
  return data.items ?? [];
}

export async function fetchIntelInvestorPaths(params?: {
  commodity?: string;
  origin?: string;
  destination?: string;
  investor?: string;
  assetId?: string;
  opportunityId?: string;
  minScore?: number;
  limit?: number;
}): Promise<IntelInvestorPath[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.destination) q.set("destination", params.destination);
  if (params?.investor) q.set("investor", params.investor);
  if (params?.assetId) q.set("asset_id", params.assetId);
  if (params?.opportunityId) q.set("opportunity_id", params.opportunityId);
  if (params?.minScore != null) q.set("min_score", String(params.minScore));
  const res = await fetch(`${API_BASE}/api/intel/investor-paths?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelInvestorPath[] };
  return data.items ?? [];
}

export async function fetchIntelArbitrage(params: {
  origin?: string;
  destination?: string;
  commodity?: string;
}): Promise<IntelArbitrage | null> {
  const q = new URLSearchParams();
  if (params.origin) q.set("origin", params.origin);
  if (params.destination) q.set("destination", params.destination);
  if (params.commodity) q.set("commodity", params.commodity);
  const res = await fetch(`${API_BASE}/api/intel/arbitrage?${q}`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<IntelArbitrage>;
}
