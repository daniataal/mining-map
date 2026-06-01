import type { VesselDrawRecord } from './vesselMarkerStyle';

/** At or above this zoom, draw every in-bounds vessel (still viewport-clipped). */
export const LOD_FULL_DETAIL_ZOOM = 7;

/** Below this map-bounds area (deg²), draw all in-view vessels (regional zoom). */
export const LOD_REGIONAL_BBOX_AREA_DEG2 = 120;

/** Max chevrons to rasterize at low zoom (display LOD cap, not clustering). */
export const LOD_MAX_DRAW = 4500;

/** Base geographic grid for world-scale subsampling (cols × rows ≈ max cells). */
export const LOD_GRID_COLS = 72;
export const LOD_GRID_ROWS = 45;

export interface VesselLodBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface VesselLodDrawPlan {
  /** Indices into the records array that should be painted. */
  drawIndices: number[];
  /** Records inside the map bounds before LOD. */
  inViewCount: number;
  /** True when grid subsampling reduced the draw set. */
  lodSubsampling: boolean;
}

function lodGridSize(mapZoom: number): { cols: number; rows: number } {
  if (mapZoom >= 6) {
    return { cols: LOD_GRID_COLS * 2, rows: LOD_GRID_ROWS * 2 };
  }
  if (mapZoom >= 4) {
    return { cols: LOD_GRID_COLS, rows: LOD_GRID_ROWS };
  }
  return { cols: Math.max(48, Math.floor(LOD_GRID_COLS * 0.75)), rows: Math.max(30, Math.floor(LOD_GRID_ROWS * 0.75)) };
}

/**
 * Estimates which vessel records would be drawn for the current map view.
 * Used by the canvas layer and Maritime Watch UI (icons drawn vs in feed).
 */
export function planVesselLodDraw(
  records: VesselDrawRecord[],
  bounds: VesselLodBounds,
  mapZoom: number,
  contains: (lat: number, lng: number) => boolean = (lat, lng) =>
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east,
): VesselLodDrawPlan {
  const inView: number[] = [];
  const n = records.length;
  for (let i = 0; i < n; i += 1) {
    const r = records[i];
    if (!contains(r.lat, r.lng)) continue;
    inView.push(i);
  }

  const latSpan = Math.max(1e-9, bounds.north - bounds.south);
  const lngSpan = Math.max(1e-9, bounds.east - bounds.west);
  const bboxArea = latSpan * lngSpan;

  if (
    mapZoom >= LOD_FULL_DETAIL_ZOOM ||
    bboxArea <= LOD_REGIONAL_BBOX_AREA_DEG2 ||
    inView.length <= LOD_MAX_DRAW
  ) {
    return { drawIndices: inView, inViewCount: inView.length, lodSubsampling: false };
  }

  const { cols, rows } = lodGridSize(mapZoom);
  const cellBest = new Map<number, number>();

  for (let k = 0; k < inView.length; k += 1) {
    const i = inView[k];
    const r = records[i];
    let cx = Math.floor(((r.lng - bounds.west) / lngSpan) * cols);
    let cy = Math.floor(((r.lat - bounds.south) / latSpan) * rows);
    cx = Math.max(0, Math.min(cols - 1, cx));
    cy = Math.max(0, Math.min(rows - 1, cy));
    const cid = cy * cols + cx;
    const prev = cellBest.get(cid);
    if (prev === undefined) {
      cellBest.set(cid, i);
      continue;
    }
    if (r.lodPriority < records[prev].lodPriority) {
      cellBest.set(cid, i);
    } else if (r.lodPriority === records[prev].lodPriority && r.id < records[prev].id) {
      cellBest.set(cid, i);
    }
  }

  let out = Array.from(cellBest.values());
  if (out.length > LOD_MAX_DRAW) {
    out.sort((a, b) => {
      const pa = records[a].lodPriority;
      const pb = records[b].lodPriority;
      if (pa !== pb) return pa - pb;
      return records[a].id.localeCompare(records[b].id);
    });
    out = out.slice(0, LOD_MAX_DRAW);
  }
  return {
    drawIndices: out,
    inViewCount: inView.length,
    lodSubsampling: out.length < inView.length,
  };
}
