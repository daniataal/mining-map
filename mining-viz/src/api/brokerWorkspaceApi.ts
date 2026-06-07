import { oilLiveApiUrl, oilLiveUserId } from './oilLiveApi';

export type BrokerWorkspace = {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkspaceEntity = {
  id: string;
  workspace_id: string;
  entity_type: string;
  ref_kind: string;
  ref_id?: string;
  display_name: string;
  lat: number;
  lng: number;
  deal_signal: 'good' | 'maybe' | 'bad';
  dd_stage: string;
  in_dd_queue: boolean;
  packed_into_pack_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type BrokerDealPack = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  map_lat?: number;
  map_lng?: number;
  status: 'draft' | 'packed' | 'archived';
  journal: DealPackJournal;
  transport: DealPackTransport;
  economics: DealPackEconomics;
  constituent_entity_ids: string[];
  created_at: string;
  updated_at: string;
};

export type DealPackJournal = {
  stage_label: string;
  done: string[];
  missing: string[];
  notes: string;
  dd_status?: string;
  next_action?: string;
};

export type DealPackRouteLeg = {
  id?: string;
  sequence: number;
  from: string;
  to: string;
  mode: 'truck' | 'rail' | 'pipeline' | 'vessel' | 'air' | 'other';
  hub_name?: string;
  notes?: string;
};

export type DealPackTransport = {
  mode?: string;
  vessel_mmsi?: string;
  vessel_imo?: string;
  vessel_name?: string;
  vessel_call_sign?: string;
  vessel_type?: string;
  vessel_tanker_class?: string;
  vessel_deadweight_tons?: number;
  vessel_max_draft_m?: number;
  vessel_flag?: string;
  vessel_last_lat?: number;
  vessel_last_lng?: number;
  vessel_last_position_at?: string;
  vessel_destination?: string;
  vessel_speed_knots?: number;
  vessel_draft_m?: number;
  vessel_crude_capable?: boolean;
  vessel_product_tanker?: boolean;
  port_id?: string;
  port_name?: string;
  terminal_id?: string;
  refinery_id?: string;
  pipeline_id?: string;
  product?: string;
  quantity?: number;
  unit?: string;
  incoterm?: string;
  route_legs?: DealPackRouteLeg[];
  route_plan_snapshot?: Record<string, unknown>;
};

export type DealPackCostItem = {
  id: string;
  label: string;
  amount: number;
  currency?: string;
  category?: 'loading' | 'unloading' | 'port_fee' | 'storage' | 'vessel' | 'inspection' | 'demurrage' | 'other';
  entity_id?: string;
  notes?: string;
};

export type DealPackEconomics = {
  buy_price?: number;
  sell_price?: number;
  volume?: number;
  freight_cost?: number;
  misc_costs?: number;
  cost_items?: DealPackCostItem[];
  margin_pct?: number;
  calculated_profit?: number;
};

export type WorkspaceEdge = {
  id: string;
  workspace_id: string;
  source_node_id: string;
  target_node_id: string;
  label?: string;
};

export type WorkspaceSearchHit = {
  type: string;
  id: string;
  score?: number;
  source: Record<string, unknown>;
};

export type WorkspaceSearchResponse = {
  hits: WorkspaceSearchHit[];
  total: number;
  query: string;
  took_ms?: number;
  degraded?: string;
  error?: string;
};

export type DealPackVesselHit = {
  mmsi: number | string;
  imo?: string;
  name?: string;
  callsign?: string;
  vessel_type?: string;
  tanker_class?: string;
  crude_capable?: boolean;
  product_tanker?: boolean;
  deadweight_tons?: number;
  max_draft_m?: number;
  flag?: string;
  lat?: number;
  lng?: number;
  last_position_at?: string;
  destination?: string;
  speed_knots?: number;
  draft_m?: number;
};

export type DealPackVesselSearchResponse = {
  vessels: DealPackVesselHit[];
  query: string;
};

export type DealPackFollowup = {
  id: string;
  pack_id: string;
  remind_at: string;
  title: string;
  message?: string;
  completed_at?: string | null;
  delivery_channel: 'in_app' | 'email';
  created_at: string;
};

export type WorkspaceMapSnapshot = {
  entities: WorkspaceEntity[];
  packs: BrokerDealPack[];
  edges: WorkspaceEdge[];
};

function brokerUserId(): string {
  return localStorage.getItem('mining_userid') || oilLiveUserId();
}

function brokerHeaders(): HeadersInit {
  const token = localStorage.getItem('mining_token') || localStorage.getItem('token');
  const h: HeadersInit = {
    'Content-Type': 'application/json',
    'X-User-Id': brokerUserId(),
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function brokerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(oilLiveApiUrl(path), {
    ...init,
    headers: { ...brokerHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `Request failed ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listBrokerWorkspaces(): Promise<{ workspaces: BrokerWorkspace[] }> {
  return brokerFetch(`/api/oil-live/workspaces?user_id=${encodeURIComponent(brokerUserId())}`);
}

export async function createBrokerWorkspace(body: {
  name: string;
  description?: string;
  is_default?: boolean;
}): Promise<{ id: string; status: string }> {
  return brokerFetch('/api/oil-live/workspaces', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateBrokerWorkspace(
  id: string,
  body: { name?: string; description?: string },
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteBrokerWorkspace(id: string): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${id}`, { method: 'DELETE' });
}

export async function getWorkspaceMap(workspaceId: string): Promise<WorkspaceMapSnapshot> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/map`);
}

export async function searchWorkspaceLicenses(
  q: string,
  limit = 12,
): Promise<WorkspaceSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  return brokerFetch(`/api/oil-live/licenses/search?${params.toString()}`);
}

export async function searchDealPackVessels(
  q: string,
  limit = 8,
): Promise<DealPackVesselSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(limit));
  return brokerFetch(`/api/oil-live/vessels/search?${params.toString()}`);
}

export async function createWorkspaceEntity(
  workspaceId: string,
  body: Partial<WorkspaceEntity> & { entity_type: string; display_name: string },
): Promise<{ id: string; status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/entities`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function importSearchEntity(
  workspaceId: string,
  body: {
    hit_type: string;
    ref_id: string;
    display_name: string;
    lat: number;
    lng: number;
    entity_type?: string;
    deal_signal?: string;
  },
): Promise<{ id: string; status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/entities/import-search`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateWorkspaceEntity(
  workspaceId: string,
  entityId: string,
  body: Partial<
    Pick<WorkspaceEntity, 'display_name' | 'lat' | 'lng' | 'deal_signal' | 'dd_stage' | 'in_dd_queue'>
  >,
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/entities/${entityId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteWorkspaceEntity(
  workspaceId: string,
  entityId: string,
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/entities/${entityId}`, {
    method: 'DELETE',
  });
}

export async function createWorkspaceEdge(
  workspaceId: string,
  body: { source_entity_id: string; target_entity_id: string; label?: string },
): Promise<{ id: string; status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/entity-edges`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listBrokerDealPacks(
  workspaceId: string,
): Promise<{ packs: BrokerDealPack[] }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs`);
}

export async function createBrokerDealPack(
  workspaceId: string,
  body: { name: string; constituent_entity_ids?: string[] },
): Promise<{ id: string; status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateBrokerDealPack(
  workspaceId: string,
  packId: string,
  body: {
    name?: string;
    journal?: DealPackJournal;
    transport?: DealPackTransport;
    economics?: DealPackEconomics;
  },
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs/${packId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function packBrokerDeal(
  workspaceId: string,
  packId: string,
  body: { map_lat: number; map_lng: number; constituent_entity_ids: string[] },
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs/${packId}/pack`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function unpackBrokerDeal(
  workspaceId: string,
  packId: string,
): Promise<{ status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs/${packId}/unpack`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function seedDefaultWorkspace(body: {
  entities: Array<{
    ref_kind: string;
    ref_id: string;
    display_name: string;
    lat: number;
    lng: number;
    deal_signal?: string;
    dd_stage?: string;
    in_dd_queue?: boolean;
  }>;
}): Promise<{ workspace_id: string; imported: number }> {
  return brokerFetch('/api/oil-live/workspaces/seed-default', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function listDealPackFollowups(
  workspaceId: string,
  packId: string,
  dueOnly = false,
): Promise<{ followups: DealPackFollowup[] }> {
  const q = dueOnly ? '?due=now' : '';
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs/${packId}/followups${q}`);
}

export async function createDealPackFollowup(
  workspaceId: string,
  packId: string,
  body: { remind_at: string; title: string; message?: string },
): Promise<{ id: string; status: string }> {
  return brokerFetch(`/api/oil-live/workspaces/${workspaceId}/packs/${packId}/followups`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function completeDealPackFollowup(
  workspaceId: string,
  packId: string,
  followupId: string,
): Promise<{ status: string }> {
  return brokerFetch(
    `/api/oil-live/workspaces/${workspaceId}/packs/${packId}/followups/${followupId}/complete`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function listDueFollowups(): Promise<{ followups: DealPackFollowup[] }> {
  return brokerFetch('/api/oil-live/workspaces/followups/due');
}

export function parsePackJournal(raw: unknown): DealPackJournal {
  const j = (raw && typeof raw === 'object' ? raw : {}) as Partial<DealPackJournal>;
  return {
    stage_label: j.stage_label ?? '',
    done: Array.isArray(j.done) ? j.done.map(String) : [],
    missing: Array.isArray(j.missing) ? j.missing.map(String) : [],
    notes: j.notes ?? '',
  };
}

export function parsePackTransport(raw: unknown): DealPackTransport {
  return (raw && typeof raw === 'object' ? raw : {}) as DealPackTransport;
}

export function parsePackEconomics(raw: unknown): DealPackEconomics {
  const economics = (raw && typeof raw === 'object' ? raw : {}) as DealPackEconomics;
  return {
    ...economics,
    cost_items: Array.isArray(economics.cost_items) ? economics.cost_items : [],
  };
}

export function calcDealProfit(e: DealPackEconomics): number {
  const vol = e.volume ?? 0;
  const buy = e.buy_price ?? 0;
  const sell = e.sell_price ?? 0;
  const itemizedCosts = (e.cost_items ?? []).reduce((sum, item) => sum + (item.amount || 0), 0);
  const costs = (e.freight_cost ?? 0) + (e.misc_costs ?? 0) + itemizedCosts;
  return vol * (sell - buy) - costs;
}
