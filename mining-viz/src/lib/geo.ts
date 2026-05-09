// Geographic helpers for the map view.
//
// Why this file exists
// --------------------
// A large chunk of license rows lack precise coordinates and instead share the
// centroid of their region/district (e.g. dozens of "Ashanti Region" licenses
// all sit on top of each other at 6.7470, -1.5209).
//
// When MarkerCluster spiderfies an exact-collision stack the markers are
// spread visually via CSS transforms but every marker still reports the same
// logical lat/lng — so `marker.openPopup()` anchors the popup at the centroid
// (hidden behind the cluster icon) and clicking a spider-leg does not show
// the per-license popup the user expected.
//
// The fix is twofold:
//   1. Apply a tiny *deterministic* jitter (driven by the row id) ONLY to
//      points that share coordinates with at least one other row. The jitter
//      is small enough (~80 m at the equator) to be invisible at country/
//      regional zoom but large enough that markercluster can give each
//      marker its own anchor at street zoom — popups now open over the
//      correct spider leg.
//   2. The jitter is deterministic, so it is stable across reloads and does
//      not introduce phantom movement between renders.
//
// We never mutate the source data — jittered rows carry the original
// coordinates in `_originalLat` / `_originalLng` for reference. Callers that
// need the canonical position (audit, export, dossier) should use the
// originals.

import type { MiningLicense } from "../types";

const COLLISION_KEY_PRECISION = 5; // ~1.1 m bucket — anything closer counts as collocated
const JITTER_MAGNITUDE_DEG = 0.0008; // ≈88 m at the equator

const positionKey = (lat: number, lng: number) =>
  `${lat.toFixed(COLLISION_KEY_PRECISION)},${lng.toFixed(COLLISION_KEY_PRECISION)}`;

// Stable 32-bit string hash (djb2 variant). Cheap and dependency-free.
const hashId = (id: string): number => {
  let h = 5381 | 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return h;
};

// Two pseudo-random offsets in [-1, 1] derived from a single id hash so the
// pair is decorrelated enough that two ids hashing close together don't end
// up overlapping again.
const jitterOffsets = (id: string): [number, number] => {
  const h = hashId(id);
  const lo = (h & 0xffff) / 0xffff; // [0,1]
  const hi = ((h >>> 16) & 0xffff) / 0xffff; // [0,1]
  return [(lo - 0.5) * 2, (hi - 0.5) * 2];
};

export interface JitteredLicense extends MiningLicense {
  _displayLat: number;
  _displayLng: number;
  _wasJittered: boolean;
  _collocatedCount: number;
}

/**
 * Return the input list with `_displayLat` / `_displayLng` set. Points that
 * share coordinates with another row are nudged by a deterministic offset;
 * everything else is passed through unchanged.
 *
 * The original `lat` / `lng` are never overwritten — consumers that care about
 * the canonical position (export, dossier, backend writes) keep using them.
 */
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
