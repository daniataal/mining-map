import { MiningLicense } from "../types";

const COLLISION_KEY_PRECISION = 5; 
const JITTER_MAGNITUDE_DEG = 0.0008; 

const positionKey = (lat: number, lng: number) =>
  `${lat.toFixed(COLLISION_KEY_PRECISION)},${lng.toFixed(COLLISION_KEY_PRECISION)}`;

const hashId = (id: string): number => {
  let h = 5381 | 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return h;
};

const jitterOffsets = (id: string): [number, number] => {
  const h = hashId(id);
  const lo = (h & 0xffff) / 0xffff; 
  const hi = ((h >>> 16) & 0xffff) / 0xffff; 
  return [(lo - 0.5) * 2, (hi - 0.5) * 2];
};

export interface JitteredLicense extends MiningLicense {
  _displayLat: number;
  _displayLng: number;
  _wasJittered: boolean;
  _collocatedCount: number;
}

export function applyCollocationJitter(rows: MiningLicense[]): JitteredLicense[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const k = positionKey(r.lat, r.lng);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  return rows.map((r) => {
    if (r.lat == null || r.lng == null) {
      return {
        ...r,
        _displayLat: r.lat,
        _displayLng: r.lng,
        _wasJittered: false,
        _collocatedCount: 0,
      } as JitteredLicense;
    }
    const k = positionKey(r.lat, r.lng);
    const collocated = counts.get(k) || 1;
    if (collocated <= 1) {
      return {
        ...r,
        _displayLat: r.lat,
        _displayLng: r.lng,
        _wasJittered: false,
        _collocatedCount: 1,
      } as JitteredLicense;
    }
    const [dx, dy] = jitterOffsets(r.id);
    return {
      ...r,
      _displayLat: r.lat + dy * JITTER_MAGNITUDE_DEG,
      _displayLng: r.lng + dx * JITTER_MAGNITUDE_DEG,
      _wasJittered: true,
      _collocatedCount: collocated,
    } as JitteredLicense;
  });
}
