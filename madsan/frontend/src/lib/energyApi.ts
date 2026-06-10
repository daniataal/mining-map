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

export async function fetchMCRCorridors(bbox?: string, limit = 300): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/mcr/corridors?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
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
