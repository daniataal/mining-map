/**
 * oil-live-intel API client (Go service on /api/oil-live).
 */
const OIL_INTEL_BASE = (import.meta.env.VITE_OIL_INTEL_BASE as string | undefined) ?? '';

export type OilLiveMapResponse = {
  terminals: OilTerminal[];
  vessels: OilLiveVessel[];
  events: OilPortCall[];
  cards: OilIntelligenceCard[];
  companies: OilCompany[];
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
  name?: string;
  lat: number;
  lng: number;
  speed?: number;
  course?: number;
  draft_m?: number;
  tanker_class?: string;
  crude_capable?: boolean;
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
  data_provenance?: OilLiveProvenance;
  metadata?: Record<string, unknown>;
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

export type OilLiveSyncStatus = {
  last_graph_sync_at?: string | null;
  terminal_count: number;
  company_count?: number;
  cargo_record_count: number;
  port_call_count: number;
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

export async function getOilLiveMap(bbox?: string): Promise<OilLiveMapResponse> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}&limit=500` : '?limit=500';
  const res = await fetch(oilUrl(`/api/oil-live/map${q}`));
  if (!res.ok) throw new Error(`oil-live map ${res.status}`);
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

export async function getOilOpportunities(minConfidence = 0.55): Promise<{ opportunities: OilOpportunity[] }> {
  const res = await fetch(oilUrl(`/api/oil-live/opportunities?min_confidence=${minConfidence}`));
  if (!res.ok) throw new Error(`oil-live opportunities ${res.status}`);
  return res.json();
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
};

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
  if (filters.exclude_seed) params.set('exclude_seed', 'true');
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
