import { lookupVesselByIMO, oilLiveApiUrl } from '../../api/oilLiveApi';
import type { MaritimeVessel } from './types';
import { normalizeMaritimeVessel } from './normalize';
import { readMaritimeSnapshotCache } from './maritimeSnapshotCache';

export type FleetVesselPick = {
  mmsi?: string;
  imo?: string;
  name?: string;
  shipvault_vessel_id?: string;
};

function findInSnapshot(pick: FleetVesselPick): MaritimeVessel | null {
  const feed = readMaritimeSnapshotCache();
  const vessels = feed?.vessels ?? [];
  const imo = String(pick.imo ?? '').trim();
  const mmsi = String(pick.mmsi ?? '').trim();
  if (mmsi) {
    const hit = vessels.find((v) => String(v.mmsi) === mmsi);
    if (hit) return hit;
  }
  if (imo) {
    const hit = vessels.find((v) => String(v.imo ?? '').trim() === imo);
    if (hit) return hit;
  }
  return null;
}

/** Resolve a fleet row to a MaritimeVessel for map selection (snapshot → API lookup → stub). */
export async function resolveFleetVesselSelection(
  pick: FleetVesselPick,
): Promise<MaritimeVessel | null> {
  const cached = findInSnapshot(pick);
  if (cached) return cached;

  const imo = String(pick.imo ?? '').trim();
  const mmsi = String(pick.mmsi ?? '').trim();
  if (imo) {
    try {
      const row = await lookupVesselByIMO(imo);
      if (row.mmsi) {
        return normalizeMaritimeVessel({
          id: `mmsi:${row.mmsi}`,
          mmsi: String(row.mmsi),
          imo,
          vessel_name: row.name || pick.name || `IMO ${imo}`,
          lat: row.lat ?? 0,
          lng: row.lng ?? 0,
          observed_at: row.position_time || new Date().toISOString(),
          source_label: 'ShipVault fleet',
        });
      }
    } catch {
      /* fall through to stub */
    }
  }

  if (mmsi) {
    try {
      const res = await fetch(oilLiveApiUrl(`/api/oil-live/vessels/${encodeURIComponent(mmsi)}`));
      if (res.ok) {
        const data = (await res.json()) as { mmsi: number; imo?: string; name?: string };
        return normalizeMaritimeVessel({
          id: `mmsi:${data.mmsi}`,
          mmsi: String(data.mmsi),
          imo: data.imo || imo || undefined,
          vessel_name: data.name || pick.name || `MMSI ${data.mmsi}`,
          lat: 0,
          lng: 0,
          observed_at: new Date().toISOString(),
          source_label: 'Registry',
        });
      }
    } catch {
      /* stub below */
    }
  }

  if (!mmsi && !imo) return null;
  return normalizeMaritimeVessel({
    id: mmsi ? `mmsi:${mmsi}` : `imo:${imo}`,
    mmsi: mmsi || '0',
    imo: imo || undefined,
    vessel_name: pick.name || (imo ? `IMO ${imo}` : `MMSI ${mmsi}`),
    lat: 0,
    lng: 0,
    observed_at: new Date().toISOString(),
    source_label: 'ShipVault fleet',
  });
}
