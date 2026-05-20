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
  draft_m?: number;
  tanker_class?: string;
  crude_capable?: boolean;
};

export type OilPortCall = {
  id: string;
  mmsi?: number;
  vessel_name?: string;
  terminal_name?: string;
  event_type?: string;
  product_family_inferred?: string;
  confidence?: number;
  estimated_volume_barrels?: number;
  evidence?: string[];
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
};

export type OilCompanyFilters = {
  q?: string;
  type?: string;
  country?: string;
  supplier_status?: string;
  min_confidence?: number;
};

function oilUrl(path: string) {
  return `${OIL_INTEL_BASE}${path}`;
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export async function getOilLiveHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(oilUrl('/api/oil-live/health'));
  if (!res.ok) throw new Error(`oil-live health ${res.status}`);
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

export async function getOilCompanies(filters: OilCompanyFilters = {}): Promise<{ companies: OilCompany[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.type) params.set('type', filters.type);
  if (filters.country) params.set('country', filters.country);
  if (filters.supplier_status) params.set('supplier_status', filters.supplier_status);
  if (filters.min_confidence != null) params.set('min_confidence', String(filters.min_confidence));
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
  terminal_name?: string;
  disclaimer?: string;
};

export async function getOilOpportunities(minConfidence = 0.55): Promise<{ opportunities: OilOpportunity[] }> {
  const res = await fetch(oilUrl(`/api/oil-live/opportunities?min_confidence=${minConfidence}`));
  if (!res.ok) throw new Error(`oil-live opportunities ${res.status}`);
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
