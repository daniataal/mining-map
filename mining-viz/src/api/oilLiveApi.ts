/**
 * oil-live-intel API client (Go service on /api/oil-live).
 */
const OIL_INTEL_BASE = (import.meta.env.VITE_OIL_INTEL_BASE as string | undefined) ?? '';

export type OilLiveMapResponse = {
  terminals: OilTerminal[];
  vessels: OilLiveVessel[];
  vessel_meta?: OilLiveVesselMeta;
  events: OilPortCall[];
  cards: OilIntelligenceCard[];
  companies: OilCompany[];
};

export type OilLiveMapLayerPoint = {
  id: string;
  kind: 'terminal' | 'vessel' | 'opportunity' | 'cargo' | string;
  lat: number;
  lng: number;
  title?: string;
  subtitle?: string;
  tier?: OilLiveProvenance;
  confidence?: number;
  source_count?: number;
  deal_score?: number;
  style_key?: string;
  ref_id?: string;
};

export type OilLiveMapLayerArc = {
  id: string;
  kind: 'cargo' | 'trade_flow' | string;
  positions: Array<[number, number]>;
  title?: string;
  subtitle?: string;
  tier?: OilLiveProvenance;
  confidence?: number;
  source_count?: number;
  deal_score?: number;
  style_key?: string;
  ref_id?: string;
};

export type OilLiveMapLayersResponse = {
  points: OilLiveMapLayerPoint[];
  arcs: OilLiveMapLayerArc[];
  coverage: unknown[];
  meta: {
    bbox?: string;
    zoom?: number;
    limit?: number;
    lod?: string;
    counts?: Record<string, number>;
    disclaimer?: string;
  };
};

export type OilLiveVesselMeta = {
  total_available?: number;
  returned_count?: number;
  cap_applied?: boolean;
  ship_type_counts?: Record<string, number>;
  limit?: number;
  source_mode?: string;
};

export type OilTerminal = {
  id: string;
  name: string;
  terminal_type?: string;
  operator_name?: string;
  country?: string;
  port?: string;
  products?: string[];
  confidence?: number;
  lat?: number;
  lng?: number;
};

export type OilLiveVessel = {
  mmsi: number;
  imo?: string | null;
  name?: string;
  vessel_name?: string;
  lat: number;
  lng: number;
  speed?: number;
  course?: number;
  draft_m?: number;
  tanker_class?: string;
  crude_capable?: boolean;
  source?: string;
  source_type?: string;
  data_source?: string;
  position_time?: string;
  freshness_seconds?: number;
  confidence?: number;
  source_url?: string | null;
};

export type OilLiveCoverageCell = {
  cell_id: string;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  observation_count: number;
  vessel_count: number;
  freshness_seconds?: number;
  sources?: string[];
  coverage_quality: 'strong' | 'fair' | 'sparse' | 'gap' | string;
  confidence?: number;
};

export type OilLiveWatchZone = {
  id: string;
  name: string;
  priority?: number;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  status?: string;
  expected_gap_reason?: string | null;
  recent_vessel_count?: number;
  last_observation_at?: string | null;
  coverage_quality: 'active' | 'sparse' | 'coverage_gap' | string;
};

export type OilLiveCoverageResponse = {
  coverage_cells: OilLiveCoverageCell[];
  watch_zones: OilLiveWatchZone[];
  freshness_minutes: number;
  sources?: string[];
  summary?: {
    coverage_quality?: string;
    cell_count?: number;
    vessels_recent?: number;
    watch_zone_count?: number;
  };
  limitations?: string[];
};

export type OilLiveVesselsResponse = {
  vessels: OilLiveVessel[];
  count: number;
  freshness_minutes?: number;
  sources?: string[];
  source_mode?: string;
  limitations?: string[];
};

export type OilLiveSourceHealth = {
  source: string;
  source_type: string;
  display_name: string;
  status: string;
  coverage_tier?: string;
  observation_count?: number;
  vessel_count?: number;
  last_observation_at?: string | null;
  limitations?: string[];
  source_url?: string | null;
  metadata?: Record<string, unknown>;
};

export type OilLiveSourceHealthResponse = {
  sources: OilLiveSourceHealth[];
  count: number;
  limitations?: string[];
};

export type OilLiveProvenance = 'seed_port_calls' | 'synthetic' | 'live_ais' | string;

export type OilPortCall = {
  id: string;
  mmsi?: number;
  vessel_name?: string;
  terminal_id?: string;
  terminal_name?: string;
  arrival_ts?: string;
  departure_ts?: string;
  status?: string;
  event_type?: string;
  product_family_inferred?: string;
  confidence?: number;
  estimated_volume_barrels?: number;
  evidence?: string[];
  bol_tier?: string;
  data_provenance?: OilLiveProvenance;
  source_links?: { name?: string; url: string }[];
  metadata?: Record<string, unknown>;
  disclaimer?: string;
};

export type VesselDossierPosition = {
  mmsi: number;
  lat?: number;
  lng?: number;
  position_time?: string;
  source?: string;
  data_source?: string;
  source_type?: string;
  source_url?: string | null;
  bol_tier?: string;
  data_provenance?: OilLiveProvenance;
  freshness_seconds?: number;
  confidence?: number;
  speed?: number;
  course?: number;
  draft_m?: number;
  vessel_name?: string;
  imo?: string | null;
};

export type VesselDossierParty = {
  role: 'shipper' | 'consignee' | string;
  name: string;
  company_id?: string;
  bol_tier?: string;
  data_provenance?: OilLiveProvenance;
  confidence?: number;
  lei?: string;
  sanctions_status?: string;
  cargo_record_id?: string;
  synthetic_bol_id?: string;
};

export type VesselDossierResponse = {
  mmsi: number;
  vessel?: Record<string, unknown>;
  position?: VesselDossierPosition | null;
  port_calls: OilPortCall[];
  cargo_records: {
    items: MeridianCargoRecord[];
    total: number;
    limit: number;
    offset: number;
  };
  parties: VesselDossierParty[];
  disclaimer?: string;
  empty_state?: string;
};

export type OilIntelligenceCard = {
  id: string;
  title?: string;
  summary?: string;
  event_type?: string;
  product_family_inferred?: string;
  possible_seller?: string;
  confidence?: number;
  evidence?: string[];
  terminal_name?: string;
  company_name?: string;
  disclaimer?: string;
};

export type OilCompanySanctionsStatus = 'clear' | 'flagged' | 'review' | 'unknown' | string;

export type OilCompany = {
  id: string;
  name: string;
  company_type?: string;
  country?: string;
  website?: string;
  confidence?: number;
  supplier_status?: string;
  supplier_id?: string | null;
  mcr_count?: number;
  event_count?: number;
  contact_count?: number;
  roles?: string[];
  sources?: string[];
  source?: string;
  /** GLEIF Legal Entity Identifier (optional — populated by Worker C). */
  lei?: string | null;
  lei_record_id?: string | null;
  /** OpenSanctions screening state (optional — populated by Worker B/C). */
  sanctions_status?: OilCompanySanctionsStatus | null;
  sanctions_checked_at?: string | null;
  sanctions_matches?: Array<Record<string, unknown>> | null;
  /** Wikidata QID + facts (optional — populated by Worker C). */
  wikidata_qid?: string | null;
  wikidata_facts?: Record<string, unknown> | null;
};

export type OilCompanyFilters = {
  q?: string;
  type?: string;
  role?: string;
  country?: string;
  supplier_status?: string;
  min_confidence?: number;
  min_events?: number;
  limit?: number;
  offset?: number;
};

export type OilCompaniesResponse = {
  companies: OilCompany[];
  count: number;
  total: number;
  offset: number;
  limit: number;
};

function oilUrl(path: string) {
  return `${OIL_INTEL_BASE}${path}`;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('mining_token') || localStorage.getItem('token');
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function adminTokenHeaders(): HeadersInit {
  const adminToken =
    (import.meta.env.VITE_ADMIN_API_TOKEN as string | undefined)?.trim() ||
    sessionStorage.getItem('meridian_admin_api_token')?.trim() ||
    '';
  const h: HeadersInit = { 'Content-Type': 'application/json', ...authHeaders() };
  if (adminToken) h['X-Admin-Token'] = adminToken;
  return h;
}

export type OilLiveContactEnrichmentBatchResult = {
  status: string;
  requested_limit?: number;
  candidates?: number;
  enriched?: number;
  skipped?: number;
  results?: Array<Record<string, unknown>>;
  note?: string;
  message?: string;
};

/** POST /api/admin/oil-live/enrich-contacts (Python backend). */
export async function enrichOilLiveContactsBatch(
  limit = 20,
): Promise<OilLiveContactEnrichmentBatchResult> {
  const backendBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  const res = await fetch(
    `${backendBase}/api/admin/oil-live/enrich-contacts?limit=${encodeURIComponent(String(limit))}`,
    { method: 'POST', headers: adminTokenHeaders() },
  );
  const data = (await res.json()) as OilLiveContactEnrichmentBatchResult;
  if (!res.ok) {
    throw new Error(data.message || `enrich-contacts ${res.status}`);
  }
  return data;
}

export type OilLiveHealth = {
  status: string;
  service: string;
  sync?: OilLiveSyncStatus;
};

export async function getOilLiveHealth(): Promise<OilLiveHealth> {
  const res = await fetch(oilUrl('/api/oil-live/health'));
  if (!res.ok) throw new Error(`oil-live health ${res.status}`);
  return res.json();
}

export type McrTierCount = { bol_tier: string; count: number };

export type TradeFlowSourceCount = { data_source: string; count: number };

export type OilLiveSyncStatus = {
  last_graph_sync_at?: string | null;
  terminal_count: number;
  company_count?: number;
  cargo_record_count: number;
  port_call_count: number;
  oil_trade_flow_count?: number;
  eia_historic_import_count?: number;
  trade_manifest_row_count?: number;
  mcr_by_tier?: McrTierCount[];
  oil_trade_flows_by_source?: TradeFlowSourceCount[];
  last_comtrade_sync_at?: string | null;
  last_comtrade_sync_status?: string | null;
  eurostat_trade_flow_count?: number;
  last_eurostat_sync_at?: string | null;
  last_eurostat_sync_status?: string | null;
  jodi_snapshot_count?: number;
  last_jodi_sync_at?: string | null;
  last_jodi_sync_status?: string | null;
  /** Port calls tagged seed/demo (excluded from production coverage). */
  demo_port_call_count?: number;
  /** MCR rows tagged seed/demo (excluded from production coverage). */
  demo_cargo_record_count?: number;
  /** MCR rows excluding seed/demo evidence. */
  production_cargo_record_count?: number;
  /** Latest vessel position observation timestamp. */
  last_vessel_observation_at?: string | null;
  /** Live AIS port calls (when returned by sync-status). */
  live_ais_port_call_count?: number;
  /** Recent live AIS vessel positions (when returned by sync-status). */
  live_vessel_count?: number;
  vessel_observation_count?: number;
  coverage_watch_zone_count?: number;
  coverage_gap_watch_zone_count?: number;
  open_opportunity_count?: number;
  corridor_full_count?: number;
  corridor_partial_count?: number;
  last_cargo_at?: string | null;
  disclaimer?: string;
};

export async function getOilLiveSyncStatus(): Promise<OilLiveSyncStatus> {
  const res = await fetch(oilUrl('/api/oil-live/sync-status'));
  if (!res.ok) throw new Error(`oil-live sync-status ${res.status}`);
  return res.json();
}

export async function getOilLiveMap(bbox?: string, zoom?: number): Promise<OilLiveMapResponse> {
  const params = new URLSearchParams();
  params.set('limit', zoom != null && zoom < 8 ? '250' : '500');
  if (bbox) params.set('bbox', bbox);
  if (zoom != null && Number.isFinite(zoom)) params.set('zoom', String(zoom));
  const res = await fetch(oilUrl(`/api/oil-live/map?${params.toString()}`));
  if (!res.ok) throw new Error(`oil-live map ${res.status}`);
  return res.json();
}

export async function getOilLiveMapLayers(options: {
  bbox: string;
  zoom?: number;
  layers?: string[];
  commodity?: string;
  dealSignal?: string;
  limit?: number;
}): Promise<OilLiveMapLayersResponse> {
  const params = new URLSearchParams();
  params.set('bbox', options.bbox);
  params.set('limit', String(options.limit ?? (options.zoom != null && options.zoom < 8 ? 250 : 500)));
  if (options.zoom != null && Number.isFinite(options.zoom)) params.set('zoom', String(options.zoom));
  if (options.layers?.length) params.set('layers', options.layers.join(','));
  if (options.commodity) params.set('commodity', options.commodity);
  if (options.dealSignal) params.set('dealSignal', options.dealSignal);
  const res = await fetch(oilUrl(`/api/oil-live/map-layers?${params.toString()}`));
  if (!res.ok) throw new Error(`oil-live map-layers ${res.status}`);
  return res.json();
}

export async function getOilLiveVessels(options: {
  bbox?: string;
  freshness_minutes?: number;
  sources?: string[];
  limit?: number;
} = {}): Promise<OilLiveVesselsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 500));
  params.set('freshness_minutes', String(options.freshness_minutes ?? 1440));
  if (options.bbox) params.set('bbox', options.bbox);
  if (options.sources?.length) params.set('sources', options.sources.join(','));
  const res = await fetch(oilUrl(`/api/oil-live/vessels?${params.toString()}`));
  if (!res.ok) throw new Error(`oil-live vessels ${res.status}`);
  return res.json();
}

export async function getOilLiveCoverage(options: {
  bbox: string;
  freshness_minutes?: number;
  sources?: string[];
}): Promise<OilLiveCoverageResponse> {
  const params = new URLSearchParams();
  params.set('bbox', options.bbox);
  params.set('freshness_minutes', String(options.freshness_minutes ?? 180));
  if (options.sources?.length) params.set('sources', options.sources.join(','));
  const res = await fetch(oilUrl(`/api/oil-live/coverage?${params.toString()}`));
  if (!res.ok) throw new Error(`oil-live coverage ${res.status}`);
  return res.json();
}

export async function getOilLiveSourceHealth(): Promise<OilLiveSourceHealthResponse> {
  const res = await fetch(oilUrl('/api/oil-live/source-health'));
  if (!res.ok) throw new Error(`oil-live source-health ${res.status}`);
  return res.json();
}

export async function getOilTerminals(): Promise<{ terminals: OilTerminal[] }> {
  const res = await fetch(oilUrl('/api/oil-live/terminals'));
  if (!res.ok) throw new Error(`oil-live terminals ${res.status}`);
  return res.json();
}

export async function getRecentPortCalls(): Promise<{ port_calls: OilPortCall[] }> {
  const res = await fetch(oilUrl('/api/oil-live/port-calls/recent'));
  if (!res.ok) throw new Error(`oil-live port-calls ${res.status}`);
  return res.json();
}

export async function getIntelligenceCards(): Promise<{ cards: OilIntelligenceCard[] }> {
  const res = await fetch(oilUrl('/api/oil-live/intelligence'));
  if (!res.ok) throw new Error(`oil-live intelligence ${res.status}`);
  return res.json();
}

export async function getOilCompanies(filters: OilCompanyFilters = {}): Promise<OilCompaniesResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.role) params.set('role', filters.role);
  if (filters.country) params.set('country', filters.country);
  if (filters.supplier_status) params.set('supplier_status', filters.supplier_status);
  if (filters.min_confidence != null) params.set('min_confidence', String(filters.min_confidence));
  if (filters.min_events != null) params.set('min_events', String(filters.min_events));
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();
  const res = await fetch(oilUrl(`/api/oil-live/companies${qs ? `?${qs}` : ''}`));
  if (!res.ok) throw new Error(`oil-live companies ${res.status}`);
  return res.json();
}

export async function getOilCompany(companyId: string): Promise<OilCompany> {
  const res = await fetch(oilUrl(`/api/oil-live/companies/${companyId}`), { headers: authHeaders() });
  if (!res.ok) throw new Error(`oil-live company ${res.status}`);
  return res.json();
}

export async function saveOilCompanyToSuppliers(companyId: string): Promise<{
  status: string;
  supplier_id?: string;
  payload?: Record<string, unknown>;
  error?: string;
}> {
  const res = await fetch(oilUrl(`/api/oil-live/companies/${companyId}/save-to-suppliers`), {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok && res.status !== 202) throw new Error(data.error || `save failed ${res.status}`);
  return data;
}

export type OilOpportunity = {
  id: string;
  opportunity_type: string;
  title?: string;
  vessel_name?: string;
  hypothesis?: string;
  confidence?: number;
  evidence?: string[];
  profit_checklist?: string[];
  terminal_id?: string;
  terminal_name?: string;
  terminal_country?: string;
  disclaimer?: string;
};

export type CargoRecordsFilters = {
  commodity?: string;
  country?: string;
  mmsi?: string | number;
  min_confidence?: number;
  /** When true, omit cargo rows derived from graph-sync seed port calls. */
  exclude_seed?: boolean;
  limit?: number;
  zoom?: number;
};

export type CargoRecordsResponse = {
  cargo_records: MeridianCargoRecord[];
  count: number;
};

export type OilDealEconomics = {
  opportunity_id: string;
  sheet: {
    volume_bbl?: number;
    buy_price_usd_per_bbl?: number;
    sell_price_usd_per_bbl?: number;
    freight_usd?: number;
    storage_usd?: number;
    other_costs_usd?: number;
    notes?: string;
  };
  result: {
    indicative_margin_usd?: number;
    margin_per_bbl_usd?: number;
    margin_pct?: number;
    complete: boolean;
    missing_fields?: string[];
  };
  public_context?: Array<Record<string, unknown>>;
  disclaimer?: string;
};

export async function getOilOpportunityEconomics(opportunityId: string): Promise<OilDealEconomics> {
  const res = await fetch(oilUrl(`/api/oil-live/opportunities/${opportunityId}/economics`));
  if (!res.ok) throw new Error(`oil-live economics ${res.status}`);
  return res.json();
}

export async function saveOilOpportunityEconomics(
  opportunityId: string,
  sheet: OilDealEconomics['sheet'],
): Promise<OilDealEconomics> {
  const res = await fetch(oilUrl(`/api/oil-live/opportunities/${opportunityId}/economics`), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(sheet),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `save economics ${res.status}`);
  return data;
}

/** Normalize opportunities list from API (always returns an array). */
export function normalizeOilOpportunitiesPayload(raw: unknown): OilOpportunity[] {
  if (Array.isArray(raw)) return raw as OilOpportunity[];
  if (raw && typeof raw === 'object') {
    const body = raw as Record<string, unknown>;
    if (Array.isArray(body.opportunities)) return body.opportunities as OilOpportunity[];
  }
  return [];
}

export type GetOilOpportunitiesOptions = {
  /** Omit demo-seeded rows (default true). Pass false to include demo opportunities. */
  exclude_demo?: boolean;
};

export async function getOilOpportunities(
  minConfidence = 0.55,
  options: GetOilOpportunitiesOptions = {},
): Promise<{ opportunities: OilOpportunity[] }> {
  const excludeDemo = options.exclude_demo !== false;
  const params = new URLSearchParams();
  params.set('min_confidence', String(minConfidence));
  if (excludeDemo) params.set('exclude_demo', 'true');
  const res = await fetch(oilUrl(`/api/oil-live/opportunities?${params}`));
  if (!res.ok) throw new Error(`oil-live opportunities ${res.status}`);
  const data = await res.json();
  return { opportunities: normalizeOilOpportunitiesPayload(data) };
}

export type DealReadinessStatus = 'complete' | 'partial' | 'missing';

export type DealReadinessItem = {
  id: string;
  label: string;
  status: DealReadinessStatus;
  weight?: number;
  detail?: string;
};

export type MeridianCargoRecord = {
  id: string;
  synthetic_bol_id?: string;
  recipe?: string;
  commodity_family?: string;
  confidence?: number;
  triangulation_score?: number;
  bol_tier?: string;
  data_provenance?: OilLiveProvenance;
  shipper_name?: string;
  consignee_name?: string;
  shipper_company_id?: string;
  consignee_company_id?: string;
  vessel_name?: string;
  mmsi?: number;
  load_port_name?: string;
  load_country?: string;
  discharge_hint?: string;
  discharge_country?: string;
  commodity_description?: string;
  volume_low?: number;
  volume_high?: number;
  volume_best_estimate?: number;
  volume_method?: string;
  volume_unit?: string;
  event_date?: string;
  created_at?: string;
  opportunity_id?: string;
  corridor_load_lat?: number;
  corridor_load_lng?: number;
  corridor_discharge_lat?: number;
  corridor_discharge_lng?: number;
  evidence_chain?: string[];
  sources?: Array<{ name?: string; url?: string; fetched_at?: string }>;
  disclaimer?: string;
  /**
   * Optional party-enrichment fields denormalised onto the MCR row by Worker C
   * (LEI carry-through + OpenSanctions screening). UI must work when these are
   * absent — the backend has not necessarily shipped them yet.
   */
  shipper_lei?: string | null;
  consignee_lei?: string | null;
  shipper_sanctions_status?: OilCompanySanctionsStatus | null;
  consignee_sanctions_status?: OilCompanySanctionsStatus | null;
};

/**
 * Aggregated trade-flow arc returned by `GET /api/oil-live/trade-flows`.
 * Worker B owns the endpoint; until that ships, the API client gracefully
 * returns `{ arcs: [], count: 0 }` so the UI does not error.
 */
export type TradeFlowArc = {
  key: string;
  group: 'company_pair' | 'country_pair';
  shipper: string;
  consignee: string;
  commodity_family: string;
  cargo_count: number;
  volume_total: number;
  volume_unit: string;
  avg_confidence: number;
  origin_lat: number;
  origin_lng: number;
  dest_lat: number;
  dest_lng: number;
  sample_mcr_ids: string[];
};

export type TradeFlowsResponse = {
  arcs: TradeFlowArc[];
  count: number;
};

export type TradeFlowsFilters = {
  group?: 'company_pair' | 'country_pair';
  commodity?: string;
  min_confidence?: number;
  limit?: number;
  zoom?: number;
};

/**
 * Fetch aggregated trade flows. Returns an empty response (no error) when the
 * backend has not yet implemented this endpoint (404) so the new map layer
 * silently renders zero arcs while we wait on Worker B.
 */
export async function getTradeFlows(
  filters: TradeFlowsFilters = {},
): Promise<TradeFlowsResponse> {
  const params = new URLSearchParams();
  if (filters.group) params.set('group', filters.group);
  if (filters.commodity) params.set('commodity', filters.commodity);
  if (filters.min_confidence != null) {
    params.set('min_confidence', String(filters.min_confidence));
  }
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.zoom != null && Number.isFinite(filters.zoom)) {
    params.set('zoom', String(filters.zoom));
  }
  const qs = params.toString();
  let res: Response;
  try {
    res = await fetch(oilUrl(`/api/oil-live/trade-flows${qs ? `?${qs}` : ''}`));
  } catch {
    return { arcs: [], count: 0 };
  }
  if (res.status === 404 || res.status === 501) return { arcs: [], count: 0 };
  if (!res.ok) {
    return { arcs: [], count: 0 };
  }
  try {
    const data = (await res.json()) as Partial<TradeFlowsResponse> | null;
    const arcs = Array.isArray(data?.arcs) ? data.arcs : [];
    return { arcs, count: data?.count ?? arcs.length };
  } catch {
    return { arcs: [], count: 0 };
  }
}

/** Deal pack shape returned by GET /opportunities/{id}/deal-pack */
export type DealExecutionPack = {
  opportunity_id: string;
  title?: string;
  hypothesis?: string;
  readiness_score?: number;
  readiness_pct?: number;
  checklist?: Array<{
    id: string;
    label: string;
    status: string;
    weight?: number;
    detail?: string;
    action?: string;
  }>;
  cargo_records?: MeridianCargoRecord[];
  port_call?: Record<string, unknown>;
  terminal?: Record<string, unknown>;
  economics?: Record<string, unknown>;
  profit_checklist?: string[];
  disclaimer?: string;
};

export type OilDealPackMovement = {
  port_call_id?: string;
  vessel_name?: string;
  mmsi?: number;
  terminal_id?: string;
  terminal_name?: string;
  event_type?: string;
  product_family_inferred?: string;
  confidence?: number;
  estimated_volume_barrels?: number;
  evidence?: string[];
  explain?: Record<string, unknown>;
};

export type OilDealPackCounterparty = {
  companies?: OilCompany[];
  hints?: Array<{
    source?: string;
    confidence?: number;
    label?: string;
    description?: string;
  }>;
  trade_flows?: Array<{
    reporter?: string;
    partner?: string;
    hs_code?: string;
    flow?: string;
    value_usd?: number;
    period?: string;
  }>;
  disclaimer?: string;
};

export type OilDealPackLogistics = {
  terminal_id?: string;
  terminal_name?: string;
  country?: string;
  port?: string;
  products?: string[];
  hints?: Record<string, unknown>;
};

export type OilDealPackContacts = {
  shipper?: OilContact[];
  consignee?: OilContact[];
  primary?: OilContact[];
  procurement_notices?: OilCompanyContactsResponse['procurement_notices'];
  procurement_note?: string;
  disclaimer?: string;
};

export type OilDealPackWorkflow = {
  can_watch?: boolean;
  watch_type?: string;
  watch_ref?: string;
  watch_label?: string;
  supplier_saved?: boolean;
  supplier_id?: string;
  deal_room_hint?: string;
};

export type OilDealPack = {
  opportunity_id: string;
  opportunity?: OilOpportunity;
  readiness_score?: number;
  readiness_items?: DealReadinessItem[];
  synthetic_cargo?: MeridianCargoRecord[];
  movement?: OilDealPackMovement;
  counterparty?: OilDealPackCounterparty;
  economics?: OilDealEconomics;
  logistics?: OilDealPackLogistics;
  contacts?: OilDealPackContacts;
  workflow?: OilDealPackWorkflow;
  disclaimer?: string;
};

export async function getOilOpportunityDealPack(opportunityId: string): Promise<OilDealPack> {
  const res = await fetch(oilUrl(`/api/oil-live/opportunities/${opportunityId}/deal-pack`));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `oil-live deal-pack ${res.status}`);
  }
  return res.json();
}

/** Alias used by DealExecutionPack UI */
export const getOpportunityDealPack = getOilOpportunityDealPack;

export async function getCargoRecords(
  filters: CargoRecordsFilters = {},
): Promise<CargoRecordsResponse> {
  const params = new URLSearchParams();
  if (filters.commodity) params.set('commodity', filters.commodity);
  if (filters.country) params.set('country', filters.country);
  if (filters.mmsi != null) params.set('mmsi', String(filters.mmsi));
  if (filters.min_confidence != null) {
    params.set('min_confidence', String(filters.min_confidence));
  }
  if (filters.exclude_seed !== false) params.set('exclude_seed', 'true');
  if (filters.limit != null) params.set('limit', String(filters.limit));
  const qs = params.toString();
  const res = await fetch(oilUrl(`/api/oil-live/cargo-records${qs ? `?${qs}` : ''}`));
  if (!res.ok) throw new Error(`oil-live cargo-records ${res.status}`);
  return res.json();
}

export async function getCargoRecord(id: string): Promise<MeridianCargoRecord> {
  const res = await fetch(oilUrl(`/api/oil-live/cargo-records/${encodeURIComponent(id)}`));
  if (!res.ok) throw new Error(`oil-live cargo-record ${res.status}`);
  return res.json();
}

export async function getVesselDossier(
  mmsi: string | number,
  opts: { mcr_limit?: number; mcr_offset?: number; port_call_limit?: number; exclude_seed?: boolean } = {},
): Promise<VesselDossierResponse> {
  const params = new URLSearchParams();
  if (opts.mcr_limit != null) params.set('mcr_limit', String(opts.mcr_limit));
  if (opts.mcr_offset != null) params.set('mcr_offset', String(opts.mcr_offset));
  if (opts.port_call_limit != null) params.set('port_call_limit', String(opts.port_call_limit));
  if (opts.exclude_seed !== false) params.set('exclude_seed', 'true');
  const qs = params.toString();
  const res = await fetch(
    oilUrl(`/api/oil-live/vessels/${encodeURIComponent(String(mmsi))}/dossier${qs ? `?${qs}` : ''}`),
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `oil-live vessel dossier ${res.status}`);
  }
  return res.json();
}

export async function getCargoRecordsMap(
  bbox: string,
  filters: Pick<
    CargoRecordsFilters,
    'commodity' | 'min_confidence' | 'exclude_seed' | 'limit' | 'zoom'
  > = {},
): Promise<CargoRecordsResponse> {
  const params = new URLSearchParams();
  params.set('bbox', bbox);
  if (filters.commodity) params.set('commodity', filters.commodity);
  if (filters.min_confidence != null) {
    params.set('min_confidence', String(filters.min_confidence));
  }
  if (filters.exclude_seed !== false) params.set('exclude_seed', 'true');
  params.set('limit', String(filters.limit ?? 200));
  if (filters.zoom != null && Number.isFinite(filters.zoom)) {
    params.set('zoom', String(filters.zoom));
  }
  const res = await fetch(oilUrl(`/api/oil-live/cargo-records/map?${params.toString()}`));
  if (!res.ok) throw new Error(`oil-live cargo-records/map ${res.status}`);
  return res.json();
}

export type CompanyShipmentsResponse = {
  company: OilCompany;
  shipments: MeridianCargoRecord[];
  total: number;
  limit: number;
  offset: number;
};

export async function getCompanyShipments(
  companyId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<CompanyShipmentsResponse> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const res = await fetch(
    oilUrl(`/api/oil-live/companies/${encodeURIComponent(companyId)}/shipments${qs ? `?${qs}` : ''}`),
  );
  if (!res.ok) throw new Error(`oil-live company shipments ${res.status}`);
  return res.json();
}

/** UN Comtrade / Census / USITC macro rows (country-pair, not vessel-level). */
export type MacroTradeFlow = {
  source?: string;
  reporter?: string;
  partner?: string;
  hs_code?: string;
  period?: string;
  flow?: string;
  trade_value_usd?: number;
  net_weight_kg?: number;
};

export async function getMacroTradeFlows(opts: {
  country?: string;
  hs_code?: string;
  limit?: number;
} = {}): Promise<{ flows: MacroTradeFlow[]; disclaimer?: string }> {
  const params = new URLSearchParams();
  if (opts.country) params.set('country', opts.country);
  if (opts.hs_code) params.set('hs_code', opts.hs_code);
  params.set('limit', String(opts.limit ?? 120));
  const res = await fetch(oilUrl(`/api/oil-live/trade/flows?${params}`));
  if (!res.ok) throw new Error(`oil-live trade/flows ${res.status}`);
  return res.json();
}

export type OilContact = {
  id?: string;
  contact_type: string;
  value: string;
  label?: string;
  source_type?: string;
  origin?: string;
};

export type OilCompanyContactsResponse = {
  company_id: string;
  company_name: string;
  supplier_id?: string;
  contacts: OilContact[];
  procurement_notices?: Array<{
    notice_id: string;
    title?: string;
    buyer?: string;
    country?: string;
    source_url?: string;
  }>;
  procurement_note?: string;
  disclaimer?: string;
};

export async function getOilCompanyContacts(companyId: string): Promise<OilCompanyContactsResponse> {
  const res = await fetch(oilUrl(`/api/oil-live/companies/${companyId}/contacts`));
  if (!res.ok) throw new Error(`oil-live contacts ${res.status}`);
  return res.json();
}

export async function addOilCompanyContact(
  companyId: string,
  body: { contact_type: string; value: string; label?: string },
): Promise<{ contact: OilContact }> {
  const res = await fetch(oilUrl(`/api/oil-live/companies/${companyId}/contacts`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `add contact ${res.status}`);
  return data;
}

export async function draftOilOutreach(companyId: string): Promise<{ draft: string; disclaimer?: string }> {
  const res = await fetch(oilUrl(`/api/oil-live/companies/${companyId}/draft-outreach`), { method: 'POST' });
  if (!res.ok) throw new Error(`draft outreach ${res.status}`);
  return res.json();
}

export function oilLiveUserId(): string {
  let id = localStorage.getItem('oil_live_user_id');
  if (!id) {
    id = typeof localStorage.getItem('username') === 'string' ? localStorage.getItem('username')! : 'default';
    localStorage.setItem('oil_live_user_id', id);
  }
  return id;
}

export type OilWatchlistItem = {
  id: string;
  user_id: string;
  watch_type: string;
  watch_ref: string;
  label?: string;
  min_confidence: number;
};

export type OilAlert = {
  id: string;
  alert_type: string;
  title: string;
  body?: string;
  severity?: string;
  ref_type?: string;
  ref_id?: string;
  read_at?: string | null;
  assigned_to?: string;
  status?: string;
};

export async function getOilWatchlists(): Promise<{ watchlists: OilWatchlistItem[] }> {
  const uid = oilLiveUserId();
  const res = await fetch(oilUrl(`/api/oil-live/watchlists?user_id=${encodeURIComponent(uid)}`));
  if (!res.ok) throw new Error(`watchlists ${res.status}`);
  return res.json();
}

export async function addOilWatchlist(body: {
  watch_type: string;
  watch_ref: string;
  label?: string;
  min_confidence?: number;
}): Promise<{ watchlist: OilWatchlistItem }> {
  const res = await fetch(oilUrl('/api/oil-live/watchlists'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...body, user_id: oilLiveUserId() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `add watchlist ${res.status}`);
  return data;
}

export async function deleteOilWatchlist(id: string): Promise<void> {
  const uid = oilLiveUserId();
  const res = await fetch(
    oilUrl(`/api/oil-live/watchlists/${id}?user_id=${encodeURIComponent(uid)}`),
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`delete watchlist ${res.status}`);
}

export async function getOilAlerts(unreadOnly = false): Promise<{ alerts: OilAlert[] }> {
  const uid = oilLiveUserId();
  const res = await fetch(
    oilUrl(`/api/oil-live/alerts?user_id=${encodeURIComponent(uid)}&unread_only=${unreadOnly}`),
  );
  if (!res.ok) throw new Error(`alerts ${res.status}`);
  return res.json();
}

export async function markOilAlertRead(alertId: string): Promise<void> {
  const uid = oilLiveUserId();
  await fetch(
    oilUrl(`/api/oil-live/alerts/${alertId}/read?user_id=${encodeURIComponent(uid)}`),
    { method: 'POST', headers: authHeaders() },
  );
}

export async function markAllOilAlertsRead(): Promise<void> {
  await fetch(oilUrl('/api/oil-live/alerts/mark-all-read'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: oilLiveUserId() }),
  });
}

export async function assignOilAlert(alertId: string, assignee: string): Promise<void> {
  await fetch(oilUrl(`/api/oil-live/alerts/${alertId}/assign`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: oilLiveUserId(), assignee }),
  });
}

/** One of the four entity types indexed in Elasticsearch. */
export type OilLiveSearchEntityType = 'cargo' | 'company' | 'terminal' | 'vessel' | 'manifest';

export type TradeManifestRow = {
  id: string;
  data_source?: string;
  bol_tier?: string;
  source_record_url?: string;
  importer_name?: string;
  exporter_name?: string;
  partner_country?: string;
  reporter_country?: string;
  hs_code?: string;
  commodity_family?: string;
  product_description?: string;
  period_year?: number;
  value_usd?: number;
};

export async function getTradeManifests(opts: {
  q?: string;
  limit?: number;
} = {}): Promise<{ manifests: TradeManifestRow[]; count: number; disclaimer?: string }> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  params.set('limit', String(opts.limit ?? 100));
  const res = await fetch(oilUrl(`/api/oil-live/trade-manifests?${params}`));
  if (!res.ok) throw new Error(`oil-live trade-manifests ${res.status}`);
  return res.json();
}

/** Subset of fields surfaced in the search drop-down per result. Source is
 * intentionally loose — it's the raw `_source` from ES and varies per type. */
export type OilLiveSearchHit = {
  type: OilLiveSearchEntityType;
  id: string;
  score: number;
  source: Record<string, unknown>;
};

export type OilLiveSearchResponse = {
  hits: OilLiveSearchHit[];
  total: number;
  took_ms: number;
  query: string;
  /** When "postgres", Elasticsearch was down and company hits came from PG ILIKE. */
  degraded?: string;
  /** When set (typically "search_unavailable"), the UI shows a degraded
   * "Search unavailable" state inline instead of throwing. */
  error?: string;
};

export type OilLiveSearchFilters = {
  q: string;
  types?: OilLiveSearchEntityType[];
  limit?: number;
  offset?: number;
};

const EMPTY_SEARCH: OilLiveSearchResponse = {
  hits: [],
  total: 0,
  took_ms: 0,
  query: '',
};

/**
 * GET /api/oil-live/search — Elasticsearch-backed search across MCRs,
 * companies, terminals, and vessels.
 *
 * Gracefully returns `{ hits: [], total: 0 }` on:
 *   - 404 (endpoint not yet deployed),
 *   - 503 (Elasticsearch container not running) — error is forwarded as
 *     `"search_unavailable"` so callers can show a degraded inline state,
 *   - network / parse errors,
 * so the search bar never crashes the panel.
 */
export async function getOilLiveSearch(
  filters: OilLiveSearchFilters,
): Promise<OilLiveSearchResponse> {
  const q = filters.q.trim();
  if (!q) return { ...EMPTY_SEARCH, query: '' };
  const params = new URLSearchParams();
  params.set('q', q);
  if (filters.types && filters.types.length > 0) {
    params.set('types', filters.types.join(','));
  }
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.offset != null) params.set('offset', String(filters.offset));
  let res: Response;
  try {
    res = await fetch(oilUrl(`/api/oil-live/search?${params.toString()}`));
  } catch {
    return { ...EMPTY_SEARCH, query: q, error: 'search_unavailable' };
  }
  if (res.status === 404) return { ...EMPTY_SEARCH, query: q };
  if (res.status === 503) {
    try {
      const body = (await res.json()) as Partial<OilLiveSearchResponse>;
      return {
        ...EMPTY_SEARCH,
        query: q,
        error: body?.error ?? 'search_unavailable',
      };
    } catch {
      return { ...EMPTY_SEARCH, query: q, error: 'search_unavailable' };
    }
  }
  if (!res.ok) return { ...EMPTY_SEARCH, query: q, error: 'search_unavailable' };
  try {
    const data = (await res.json()) as Partial<OilLiveSearchResponse>;
    return {
      hits: Array.isArray(data.hits) ? (data.hits as OilLiveSearchHit[]) : [],
      total: typeof data.total === 'number' ? data.total : 0,
      took_ms: typeof data.took_ms === 'number' ? data.took_ms : 0,
      query: typeof data.query === 'string' ? data.query : q,
      degraded: typeof data.degraded === 'string' ? data.degraded : undefined,
      error: data.error,
    };
  } catch {
    return { ...EMPTY_SEARCH, query: q };
  }
}

export type OilLiveSearchHealth = {
  status: 'ok' | 'unavailable';
  indices: Record<string, number>;
};

/**
 * GET /api/oil-live/search/health — checks ES reachability and returns the
 * doc count per index. Returns `{status:"unavailable", indices:{}}` on any
 * non-2xx response so the admin UI can render a single status pill.
 */
export async function getOilLiveSearchHealth(): Promise<OilLiveSearchHealth> {
  try {
    const res = await fetch(oilUrl('/api/oil-live/search/health'));
    if (!res.ok) return { status: 'unavailable', indices: {} };
    const data = (await res.json()) as Partial<OilLiveSearchHealth>;
    return {
      status: data.status === 'ok' ? 'ok' : 'unavailable',
      indices: (data.indices ?? {}) as Record<string, number>,
    };
  } catch {
    return { status: 'unavailable', indices: {} };
  }
}

export function connectOilLiveWebSocket(onMessage: (msg: { type: string; data: unknown }) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = OIL_INTEL_BASE
    ? new URL(OIL_INTEL_BASE).host
    : window.location.host;
  const ws = new WebSocket(`${proto}://${host}/api/oil-live/ws`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  return () => ws.close();
}
