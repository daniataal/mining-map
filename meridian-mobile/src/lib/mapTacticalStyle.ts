/**
 * Tactical map colors aligned with mining-viz `MapComponent` + `App.css`
 * (Leaflet clusters, GeoJSON borders, commodity marker dots).
 */

export const TACTICAL_GEOJSON = {
  /** Leaflet GeoJSON stroke/fill in MapComponent */
  stroke: '#06b6d4',
  fill: '#06b6d4',
  /** RN alpha on colors (hex suffix) */
  strokeAlpha: '99',
  fillAlpha: '14',
  strokeWidth: 2,
} as const;

/** `.custom-cluster-icon` — blue glass cluster */
export const TACTICAL_CLUSTER = {
  background: 'rgba(59, 130, 246, 0.25)',
  border: 'rgba(59, 130, 246, 0.65)',
  text: '#FFFFFF',
  /** Outer hit/snapshot padding so the circle isn’t clipped on Android markers */
  outerSize: 56,
  innerSize: 40,
  borderWidth: 1,
} as const;

/** Spider legs in web: `#64748b` @ 0.5 opacity */
export const TACTICAL_SPIDER_LINE = 'rgba(100, 116, 139, 0.55)';

export function tacticalMarkerColor(commodity?: string | null): string {
  const c = (commodity ?? '').toLowerCase();
  if (c.includes('gold')) return '#FFD700';
  if (c.includes('diamond')) return '#60a5fa';
  if (c.includes('bauxite')) return '#f87171';
  if (c.includes('manganese')) return '#a78bfa';
  if (c.includes('lithium')) return '#34d399';
  return '#64748b';
}

export function tacticalMarkerDiameterPx(commodity?: string | null): number {
  const c = (commodity ?? '').toLowerCase();
  const isGold = c.includes('gold');
  return isGold ? 14 : 10;
}
