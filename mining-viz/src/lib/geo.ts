// Geographic helpers for the map view.
//
// Many license rows share the same region/district centroid (e.g. dozens of
// Ghana licenses at one Ashanti point). Tiny per-id jitter (~88 m) is invisible
// at country zoom — MarkerCluster still merges them into one mega-cluster, and
// spiderfyOnMaxZoom draws a huge "flower" into the ocean.
//
// For collocated groups we spread display positions on a small disc (canonical
// lat/lng unchanged). MarkerCluster then forms multiple sub-clusters; click
// zooms in instead of spiderfying hundreds of legs.

import type { MiningLicense } from '../types';

const COLLISION_KEY_PRECISION = 5; // ~1.1 m bucket — anything closer counts as collocated

/** Max spread radius (degrees) for a collocated stack — ~4.4 km at equator. */
export const MAX_SPREAD_RADIUS_DEG = 0.04;

/** Scales spread with sqrt(n) before cap. */
export const SPREAD_RADIUS_PER_SQRT_N = 0.00015;

const positionKey = (lat: number, lng: number) =>
  `${lat.toFixed(COLLISION_KEY_PRECISION)},${lng.toFixed(COLLISION_KEY_PRECISION)}`;

/** Disc radius for n collocated markers (degrees). */
export function spreadRadiusDeg(collocatedCount: number): number {
  if (collocatedCount <= 1) return 0;
  return Math.min(MAX_SPREAD_RADIUS_DEG, SPREAD_RADIUS_PER_SQRT_N * Math.sqrt(collocatedCount));
}

/**
 * Deterministic offset on a disc around (lat, lng) for index i of n collocated rows.
 * Golden-angle spacing avoids radial spokes.
 */
export function collocatedDisplayOffset(
  lat: number,
  lng: number,
  index: number,
  total: number,
): { dLat: number; dLng: number } {
  if (total <= 1) return { dLat: 0, dLng: 0 };
  const maxR = spreadRadiusDeg(total);
  const t = (index + 0.5) / total;
  const r = maxR * Math.sqrt(t);
  const golden = 2.399963229728653;
  const angle = index * golden;
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  return {
    dLat: r * Math.cos(angle),
    dLng: (r * Math.sin(angle)) / cosLat,
  };
}

export interface JitteredLicense extends MiningLicense {
  _displayLat: number;
  _displayLng: number;
  _wasJittered: boolean;
  _collocatedCount: number;
}

/**
 * Return the input list with `_displayLat` / `_displayLng` set. Collocated rows
 * are spread on a small disc; singletons pass through unchanged.
 */
export function applyCollocationJitter(rows: MiningLicense[]): JitteredLicense[] {
  const counts = new Map<string, number>();
  const groups = new Map<string, MiningLicense[]>();

  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const k = positionKey(r.lat, r.lng);
    counts.set(k, (counts.get(k) || 0) + 1);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const indexInGroup = new Map<string, number>();
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    list.forEach((r, i) => indexInGroup.set(r.id, i));
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
    const idx = indexInGroup.get(r.id) ?? 0;
    const { dLat, dLng } = collocatedDisplayOffset(r.lat, r.lng, idx, collocated);
    return {
      ...r,
      _displayLat: r.lat + dLat,
      _displayLng: r.lng + dLng,
      _wasJittered: true,
      _collocatedCount: collocated,
    } as JitteredLicense;
  });
}
