/**
 * Geometry + styling helpers for cargo-corridor arrows on the Live Data map.
 *
 * These helpers are deliberately pure (no Leaflet imports) so that the
 * rendering layer can stay thin and the math can be unit-tested directly.
 *
 * Used by `OilLiveMapOverlays.tsx` (per-MCR arrows + aggregated Trade Flow
 * arcs) and `CompanyImportsExportsTab.tsx` (mini-arrows).
 */

export type LatLng = { lat: number; lng: number };
export type LatLngTuple = [number, number];

/**
 * Returns a 3-point polyline (load, mid, discharge) where the mid point is
 * offset perpendicularly from the straight load→discharge line so that
 * multiple arrows sharing the same endpoints don't collapse onto each other.
 *
 * `offsetIdx` selects from a deterministic stacking pattern — index 0 bends
 * one way at a baseline amount, index 1 bends the other way at the same
 * amount, index 2/3 bend further out, etc. Caller picks any stable integer
 * (e.g. the position of the arrow in a deduped list).
 */
export function bezierMidpoint(
  load: LatLng | LatLngTuple,
  discharge: LatLng | LatLngTuple,
  offsetIdx = 0,
): [LatLngTuple, LatLngTuple, LatLngTuple] {
  const a = toTuple(load);
  const b = toTuple(discharge);

  const midLat = (a[0] + b[0]) / 2;
  const midLng = (a[1] + b[1]) / 2;

  const dLat = b[0] - a[0];
  const dLng = b[1] - a[1];
  const length = Math.hypot(dLat, dLng);

  if (!Number.isFinite(length) || length === 0) {
    return [a, [midLat, midLng], b];
  }

  // Unit perpendicular vector (rotate (dLat, dLng) by +90°).
  const perpLat = -dLng / length;
  const perpLng = dLat / length;

  const safeIdx = Number.isFinite(offsetIdx) ? Math.trunc(offsetIdx) : 0;
  const tier = Math.floor(Math.abs(safeIdx) / 2);
  const sign = safeIdx % 2 === 0 ? 1 : -1;
  const bendRatio = 0.08 + 0.05 * tier;
  const bendDistance = bendRatio * length * sign;

  const bentLat = midLat + perpLat * bendDistance;
  const bentLng = midLng + perpLng * bendDistance;

  return [a, [bentLat, bentLng], b];
}

/**
 * Stable hex color per commodity family. Unknown families fall back to a
 * neutral slate so legend stays consistent across the app.
 */
export function commodityColor(family?: string | null): string {
  const key = normalizeFamily(family);
  return COMMODITY_COLORS[key] ?? COMMODITY_COLORS.default;
}

const COMMODITY_COLORS: Record<string, string> = {
  crude_oil: '#0ea5e9',
  crude: '#0ea5e9',
  fuel_oil: '#7c3aed',
  bunker: '#7c3aed',
  diesel: '#f59e0b',
  gasoil: '#f97316',
  gasoline: '#ef4444',
  jet_fuel: '#22d3ee',
  jet: '#22d3ee',
  kerosene: '#22d3ee',
  lng: '#06b6d4',
  lpg: '#a855f7',
  naphtha: '#10b981',
  condensate: '#84cc16',
  products: '#ec4899',
  petroleum_products: '#ec4899',
  bitumen: '#475569',
  asphalt: '#475569',
  lubricants: '#0d9488',
  base_oils: '#0d9488',
  methanol: '#facc15',
  ammonia: '#fb923c',
  default: '#64748b',
};

function normalizeFamily(family?: string | null): string {
  if (!family) return 'default';
  return family.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Log-scaled stroke weight in pixels from the cargo's `volume_best_estimate`
 * (assumed barrels for liquids, MT for refined products — same log family
 * either way). Clamped to [1, 6] for readability on the map.
 */
export function volumeToWeight(volume_best_estimate?: number | null): number {
  if (volume_best_estimate == null || !Number.isFinite(volume_best_estimate) || volume_best_estimate <= 0) {
    return 2;
  }
  const log = Math.log10(volume_best_estimate);
  // log10(1k) = 3, log10(10M) = 7. Map [3, 6.7] → [1, 6].
  const minLog = 3;
  const maxLog = 6.7;
  const t = (log - minLog) / (maxLog - minLog);
  const w = 1 + 5 * t;
  return clamp(roundTo(w, 1), 1, 6);
}

/**
 * Opacity decay with event recency: full opacity for events younger than
 * 30 days, 0.4 for events older than 180 days, linear in between. Missing
 * or unparseable dates fall back to a neutral 0.7.
 */
export function recencyOpacity(event_date?: string | null, nowMs?: number): number {
  if (!event_date) return 0.7;
  const ts = Date.parse(event_date);
  if (!Number.isFinite(ts)) return 0.7;
  const now = nowMs ?? Date.now();
  const ageDays = (now - ts) / 86_400_000;
  if (ageDays <= 30) return 1.0;
  if (ageDays >= 180) return 0.4;
  const t = (ageDays - 30) / 150; // 0..1
  const op = 1.0 - 0.6 * t;
  return roundTo(op, 2);
}

/**
 * Dash pattern for the corridor line. Returns `undefined` for a solid stroke.
 *
 * Rules:
 *   - triangulation_score >= 4 ⇒ solid (high-evidence corridor, see
 *     `tierDoubleStroke` for the secondary line).
 *   - data_provenance === 'live_ais' ⇒ solid.
 *   - bol_tier === 'synthetic' or data_provenance === 'seed_port_calls' ⇒
 *     dashed (`'8 6'`).
 *   - otherwise solid.
 */
export function tierDashArray(
  bol_tier?: string | null,
  data_provenance?: string | null,
  triangulation_score?: number | null,
): string | undefined {
  if (triangulation_score != null && triangulation_score >= 4) return undefined;
  if (data_provenance === 'live_ais') return undefined;
  if (bol_tier === 'synthetic' || data_provenance === 'seed_port_calls') return '8 6';
  return undefined;
}

/**
 * Whether to render a secondary parallel stroke (double-line effect) to
 * signal a very high-confidence corridor. Used by the renderer alongside
 * `tierDashArray`.
 */
export function tierDoubleStroke(triangulation_score?: number | null): boolean {
  return triangulation_score != null && triangulation_score >= 4;
}

function toTuple(point: LatLng | LatLngTuple): LatLngTuple {
  if (Array.isArray(point)) return [point[0], point[1]];
  return [point.lat, point.lng];
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
