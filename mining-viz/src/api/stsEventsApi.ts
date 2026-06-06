/**
 * STS (ship-to-ship) proximity events — Go oil-live-intel API.
 */
import { oilLiveApiUrl } from './oilLiveApi';

export type StsConfidenceTier = 'low' | 'medium' | 'high' | 'very_high' | 'verified' | string;

export type StsEnrichmentStatus = 'none' | 'pending' | 'partial' | 'complete' | string;

export type StsLinkedPortCall = {
  id?: string;
  mmsi?: number;
  vessel_name?: string;
  terminal_id?: string;
  terminal_name?: string;
  arrival_ts?: string;
  departure_ts?: string;
  status?: string;
  product_family_inferred?: string;
  confidence?: number;
  bol_tier?: string;
  data_provenance?: string;
  disclaimer?: string;
  role?: 'vessel_a' | 'vessel_b' | string;
};

export type StsCargoHypothesis = {
  id?: string;
  commodity_family?: string;
  commodity_description?: string;
  confidence?: number;
  bol_tier?: string;
  data_provenance?: string;
  shipper_name?: string;
  consignee_name?: string;
  load_port_name?: string;
  discharge_hint?: string;
  disclaimer?: string;
  inference_basis?: string;
};

export type StsVesselRef = {
  mmsi: number;
  name?: string;
  tanker_class?: string;
};

export type StsEvent = {
  id: string;
  mmsi_a: number;
  mmsi_b: number;
  start_ts: string;
  end_ts: string;
  centroid_lat?: number;
  centroid_lon?: number;
  lat?: number;
  lon?: number;
  min_distance_m?: number;
  avg_sog?: number;
  confidence_tier: StsConfidenceTier;
  confidence_score?: number;
  status?: string;
  data_source?: string;
  evidence?: string[];
  zone_id?: string;
  zone_name?: string;
  vessel_a?: StsVesselRef;
  vessel_b?: StsVesselRef;
  metadata?: Record<string, unknown>;
  enrichment_status?: StsEnrichmentStatus;
  linked_port_calls?: StsLinkedPortCall[];
  cargo_hypotheses?: StsCargoHypothesis[];
  verification_notes?: string;
  verified_at?: string;
  verified_by?: string;
};

export type StsDisclaimer = {
  inference_only?: boolean;
  status_meaning?: string;
  limitations?: string[];
};

export type StsEventsResponse = {
  events: StsEvent[];
  count: number;
  from?: string;
  to?: string;
  disclaimer?: StsDisclaimer;
  data_source?: string;
};

export type StsEventsSummaryResponse = {
  count: number;
  by_confidence_tier?: Record<string, number>;
  from?: string;
  to?: string;
  disclaimer?: StsDisclaimer;
};

export type StsEventDetailResponse = StsEvent & {
  disclaimer?: StsDisclaimer;
};

export type VesselStsHistoryResponse = StsEventsResponse & {
  mmsi: number;
};

function stsUrl(path: string, params?: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') q.set(k, String(v));
    }
  }
  const qs = q.toString();
  return oilLiveApiUrl(`${path}${qs ? `?${qs}` : ''}`);
}

export function stsEventCoords(event: StsEvent): { lat: number; lon: number } | null {
  const lat = event.centroid_lat ?? event.lat;
  const lon = event.centroid_lon ?? event.lon;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function stsVesselLabel(event: StsEvent, side: 'a' | 'b'): string {
  const ref = side === 'a' ? event.vessel_a : event.vessel_b;
  const mmsi = side === 'a' ? event.mmsi_a : event.mmsi_b;
  const name = ref?.name?.trim();
  if (name) return name;
  return `MMSI ${mmsi}`;
}

export function stsInferenceDisclaimer(disclaimer?: StsDisclaimer | null): string {
  if (disclaimer?.status_meaning) return disclaimer.status_meaning;
  return 'Inferred proximity — not verified cargo transfer';
}

export function isStsEventVerified(event: StsEvent): boolean {
  const status = (event.status ?? '').toLowerCase();
  const tier = (event.confidence_tier ?? '').toLowerCase();
  return status === 'verified' || tier === 'verified';
}

export function stsEventHasEnrichment(event: StsEvent): boolean {
  const status = (event.enrichment_status ?? '').toLowerCase();
  return (
    (status !== '' && status !== 'none') ||
    (event.linked_port_calls?.length ?? 0) > 0 ||
    (event.cargo_hypotheses?.length ?? 0) > 0
  );
}

function stsPatchHeaders(): HeadersInit {
  const token = localStorage.getItem('mining_token') || localStorage.getItem('token');
  const adminToken =
    (import.meta.env.VITE_ADMIN_API_TOKEN as string | undefined)?.trim() ||
    sessionStorage.getItem('meridian_admin_api_token')?.trim() ||
    '';
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (adminToken) h['X-Admin-Token'] = adminToken;
  return h;
}

export function stsViewportBbox(viewport: {
  west: number;
  south: number;
  east: number;
  north: number;
}): string {
  return `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`;
}

/** GET /api/oil-live/sts-events/summary — viewport counts without event payloads. */
export async function getStsEventsSummary(
  bbox: string,
  options: { from?: string; to?: string } = {},
): Promise<StsEventsSummaryResponse> {
  const res = await fetch(
    stsUrl('/api/oil-live/sts-events/summary', {
      bbox,
      from: options.from,
      to: options.to,
    }),
  );
  if (!res.ok) throw new Error(`sts-events-summary ${res.status}`);
  return res.json();
}

/** GET /api/oil-live/sts-events/{id} — full enrichment for map popup / dossier. */
export async function getStsEventById(id: string): Promise<StsEventDetailResponse> {
  const res = await fetch(stsUrl(`/api/oil-live/sts-events/${encodeURIComponent(id)}`));
  if (!res.ok) throw new Error(`sts-event ${res.status}`);
  return res.json();
}

/** GET /api/oil-live/sts-events */
export async function getStsEvents(options: {
  bbox?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<StsEventsResponse> {
  const res = await fetch(
    stsUrl('/api/oil-live/sts-events', {
      bbox: options.bbox,
      from: options.from,
      to: options.to,
      limit: options.limit,
    }),
  );
  if (!res.ok) throw new Error(`sts-events ${res.status}`);
  return res.json();
}

/** GET /api/oil-live/vessels/{mmsi}/sts-history */
export async function getVesselStsHistory(
  mmsi: string | number,
  options: { from?: string; to?: string; limit?: number } = {},
): Promise<VesselStsHistoryResponse> {
  const res = await fetch(
    stsUrl(`/api/oil-live/vessels/${encodeURIComponent(String(mmsi))}/sts-history`, {
      from: options.from,
      to: options.to,
      limit: options.limit,
    }),
  );
  if (!res.ok) throw new Error(`sts-history ${res.status}`);
  return res.json();
}

export type VerifyStsEventResponse = {
  event?: StsEvent;
} & Partial<StsEvent>;

/** PATCH /api/oil-live/sts-events/{id} — analyst verification (requires backend + analyst mode). */
export async function verifyStsEvent(
  id: string,
  notes: string,
): Promise<VerifyStsEventResponse> {
  const res = await fetch(stsUrl(`/api/oil-live/sts-events/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: stsPatchHeaders(),
    body: JSON.stringify({ status: 'verified', notes }),
  });
  if (!res.ok) {
    let detail = `verify-sts ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string; message?: string };
      detail = err.error ?? err.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}
