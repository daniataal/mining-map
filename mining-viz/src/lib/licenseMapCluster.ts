import type { MiningLicense } from '../types';
import type { LicenseViewportBounds } from './licenseViewportBounds';
import { pointInLicenseViewportBounds } from './licenseCountryMatch';
import { refineClusterLandPosition } from './licenseClusterLand';
import { isCountryLicenseSummary } from './licenseCountrySummary';

/** Ignore singleton server grid cells (backend should omit; safety net). */
export const MIN_SERVER_LICENSE_CLUSTER_COUNT = 2;

/** Server-side viewport aggregate (not a real license row). */
export function isServerLicenseCluster(item: MiningLicense | null | undefined): boolean {
  if (!item) return false;
  if (isCountryLicenseSummary(item)) return true;
  if ((item.mapClusterCount ?? 0) > 0) return true;
  if (item.id.startsWith('cluster:')) return true;
  return item.licenseType === 'Cluster';
}

/** Bbox padding (degrees) to refetch individual licenses after zooming into a cluster. */
export function clusterExpandPaddingDeg(item: MiningLicense): number {
  if (isCountryLicenseSummary(item)) {
    const n = item.mapClusterCount ?? 10;
    if (n > 500) return 12;
    if (n > 100) return 8;
    return 5;
  }
  const grid = item.mapClusterGridDeg;
  if (grid != null && grid > 0) return Math.max(0.25, grid * 0.55);
  const n = item.mapClusterCount ?? 10;
  if (n > 150) return 1.0;
  if (n > 40) return 0.55;
  return 0.35;
}

/** Match MapComponent default zoom for license views (must align API zoom with map). */
export const LICENSE_MAP_DEFAULT_ZOOM = 7;

/** Server grid mode ends below this zoom (matches backend license_grid_degrees z >= 8). */
export const SERVER_CLUSTER_MIN_DRILL_ZOOM = 8;

/** Canvas stops merging nearby points above this zoom (see LICENSE_CANVAS_CLUSTER_MAX_ZOOM). */
export const LICENSE_CANVAS_CLUSTER_UNPACK_ZOOM = 14;

/** Max zoom when drilling client/dense clusters — one step above canvas unpack. */
export const LICENSE_CLIENT_CLUSTER_EXPAND_ZOOM = LICENSE_CANVAS_CLUSTER_UNPACK_ZOOM + 1;

/** Dense grid/server bubbles (≥10) need deep drill or canvas re-clusters immediately. */
export const LICENSE_DENSE_CLUSTER_MIN_COUNT = 10;

/** Max zoom when drilling a low-zoom country-summary hub (e.g. "1129" for Ghana). */
export const LICENSE_COUNTRY_SUMMARY_DRILL_MAX_ZOOM = 10;

/** Zoom into a country-summary hub — always step in, never fit the huge server padding bbox. */
export function countrySummaryDrillTargetZoom(currentZoom: number): number {
  const stepped = Math.max(currentZoom + 1, SERVER_CLUSTER_MIN_DRILL_ZOOM);
  return Math.min(LICENSE_COUNTRY_SUMMARY_DRILL_MAX_ZOOM, stepped);
}

/** Step zoom in for any cluster drill — never hold at the same zoom level. */
export function steppedClusterDrillTargetZoom(currentZoom: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(currentZoom + 2, SERVER_CLUSTER_MIN_DRILL_ZOOM));
}

/** Map zoom to fly when opening a cluster bubble into individual markers. */
export function licenseClusterVisualDrillZoom(
  mapClusterCount: number,
  options?: { clientCluster?: boolean; countrySummary?: boolean },
): number {
  if (options?.countrySummary) return LICENSE_COUNTRY_SUMMARY_DRILL_MAX_ZOOM;
  if (options?.clientCluster) return LICENSE_CLIENT_CLUSTER_EXPAND_ZOOM;
  if (mapClusterCount >= LICENSE_DENSE_CLUSTER_MIN_COUNT) {
    return LICENSE_CLIENT_CLUSTER_EXPAND_ZOOM;
  }
  return SERVER_CLUSTER_MIN_DRILL_ZOOM;
}

/** Do not collapse grid cells into one mega-bubble above this license total (regional honesty). */
export const MAX_VIEWPORT_CLUSTER_MERGE_TOTAL = 400;

function clusterCenter(row: MiningLicense): { lat: number; lng: number } | null {
  const lat = row._displayLat ?? row.lat;
  const lng = row._displayLng ?? row.lng;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function clusterInsideViewportInterior(
  lat: number,
  lng: number,
  bounds: { south: number; north: number; west: number; east: number },
  gridDeg: number,
): boolean {
  if (
    lat < bounds.south ||
    lat > bounds.north ||
    lng < bounds.west ||
    lng > bounds.east
  ) {
    return false;
  }
  const grid = gridDeg > 0 ? gridDeg : 8;
  const edge = Math.max(grid * 0.25, 0.5);
  if (
    lat - bounds.south < edge ||
    bounds.north - lat < edge ||
    lng - bounds.west < edge ||
    bounds.east - lng < edge
  ) {
    return false;
  }
  return true;
}

/** Largest grid cell center — not count-weighted centroid (avoids offshore drift). */
export function pickDominantClusterCenter(
  rows: Pick<MiningLicense, 'lat' | 'lng' | 'mapClusterCount'>[],
): { lat: number; lng: number } | null {
  let bestCount = -1;
  let best: { lat: number; lng: number } | null = null;
  for (const row of rows) {
    const n = row.mapClusterCount ?? 0;
    if (row.lat == null || row.lng == null || n <= bestCount) continue;
    bestCount = n;
    best = { lat: row.lat, lng: row.lng };
  }
  return best;
}

/** Snap misaligned global-grid centers into the viewport interior (country focus safety net). */
export function snapClusterBubblePosition(
  lat: number,
  lng: number,
  bounds: { south: number; north: number; west: number; east: number },
  gridDeg: number,
): { lat: number; lng: number } {
  const grid = gridDeg > 0 ? gridDeg : 8;
  if (clusterInsideViewportInterior(lat, lng, bounds, grid)) {
    return { lat, lng };
  }
  return {
    lat: (bounds.south + bounds.north) / 2,
    lng: (bounds.west + bounds.east) / 2,
  };
}

/** Low-zoom server clusters: land snap + viewport safety net for misaligned grid centers. */
export function applyServerClusterDisplayPositions(
  rows: MiningLicense[],
  bounds: LicenseViewportBounds | null | undefined,
  mapZoom: number | undefined,
): MiningLicense[] {
  if (!bounds || mapZoom == null || mapZoom >= SERVER_CLUSTER_MIN_DRILL_ZOOM) {
    return rows;
  }
  return rows.map((row) => {
    if (!isServerLicenseCluster(row) || row.lat == null || row.lng == null) return row;
    const grid = row.mapClusterGridDeg ?? 8;
    const rawLat = row.lat;
    const rawLng = row.lng;
    const onLand = refineClusterLandPosition(rawLat, rawLng, row.country);
    const snapped = snapClusterBubblePosition(onLand.lat, onLand.lng, bounds, grid);
    const refined = refineClusterLandPosition(snapped.lat, snapped.lng, row.country);
    return {
      ...row,
      lat: refined.lat,
      lng: refined.lng,
      _displayLat: refined.lat,
      _displayLng: refined.lng,
    };
  });
}

/** Keep only rows whose coordinates fall inside the map bbox. */
export function filterLicenseMapRowsToBounds(
  rows: MiningLicense[],
  bounds: LicenseViewportBounds | null | undefined,
): MiningLicense[] {
  if (!bounds) return rows;
  return rows.filter((row) => {
    const center = clusterCenter(row);
    if (!center) return false;
    return pointInLicenseViewportBounds(center.lat, center.lng, bounds);
  });
}

/** Merge server grid clusters into one solo-style bubble for country/regional zoom. */
export function collapseServerClustersInViewport(
  rows: MiningLicense[],
  bounds: { south: number; north: number; west: number; east: number } | null,
  mapZoom: number | undefined,
): MiningLicense[] {
  const nonClusters = rows.filter((row) => !isServerLicenseCluster(row));
  const clusters = rows.filter(isServerLicenseCluster);
  if (clusters.length <= 1) return rows;
  if (mapZoom == null || mapZoom >= SERVER_CLUSTER_MIN_DRILL_ZOOM) return rows;
  const span = bounds
    ? Math.max(bounds.north - bounds.south, bounds.east - bounds.west)
    : 0;
  if (span <= 0 || span >= 22) return rows;

  const inView = bounds
    ? clusters.filter((row) => {
        const center = clusterCenter(row);
        return center
          ? pointInLicenseViewportBounds(center.lat, center.lng, bounds)
          : false;
      })
    : clusters;
  if (inView.length <= 1) {
    return [...nonClusters, ...inView];
  }

  let total = 0;
  let country = '';
  let sector = 'mining';
  const grid = inView[0].mapClusterGridDeg ?? 8;
  for (const row of inView) {
    const n = row.mapClusterCount ?? 0;
    total += n;
    if (!country && row.country) country = row.country;
    if (row.sector) sector = row.sector;
  }
  if (total <= 0) return [...nonClusters, ...inView];
  if (total > MAX_VIEWPORT_CLUSTER_MERGE_TOTAL) {
    return [...nonClusters, ...inView];
  }
  const dominant = pickDominantClusterCenter(inView);
  if (!dominant) return [...nonClusters, ...inView];
  const onLand = refineClusterLandPosition(dominant.lat, dominant.lng, country);
  const snapped = bounds
    ? snapClusterBubblePosition(onLand.lat, onLand.lng, bounds, grid)
    : onLand;
  const refined = refineClusterLandPosition(snapped.lat, snapped.lng, country);
  const lat = refined.lat;
  const lng = refined.lng;
  const merged: MiningLicense = {
    id: `cluster:${lat.toFixed(4)}:${lng.toFixed(4)}`,
    company: `${total} licenses`,
    licenseType: 'Cluster',
    commodity: '',
    status: 'Active',
    date: null,
    country,
    region: '',
    sector: sector as MiningLicense['sector'],
    lat,
    lng,
    mapClusterCount: total,
    mapClusterGridDeg: grid,
    entityKind: 'license',
    _displayLat: lat,
    _displayLng: lng,
  };
  return [...nonClusters, merged];
}

/**
 * Low-zoom clusters via Go `/api/oil-live/licenses/map` (MAD-42).
 * Default on; opt out with VITE_LICENSE_MAP_GO=0 or false.
 */
export function resolveLicenseMapGoEnabled(
  raw: string | undefined = import.meta.env.VITE_LICENSE_MAP_GO,
): boolean {
  if (raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  return true;
}

export const LICENSE_MAP_GO_ENABLED = resolveLicenseMapGoEnabled();

/**
 * Staging cutover: skip Python `/licenses` fallback when Go paths fail.
 * Pair with `VITE_LICENSE_MAP_SHADOW_METRICS=1` and parity scripts before prod.
 */
export function resolveLicenseMapGoStrict(
  raw: string | undefined = import.meta.env.VITE_LICENSE_MAP_GO_STRICT,
): boolean {
  return raw === '1' || raw === 'true';
}

export const LICENSE_MAP_GO_STRICT = resolveLicenseMapGoStrict();

/** Ordered license fetch paths (Go-first, optional Python fallback). */
export function licenseFetchPaths(useClusterPath: boolean): string[] {
  if (!LICENSE_MAP_GO_ENABLED) return ['/licenses'];
  const pythonFallback = LICENSE_MAP_GO_STRICT ? [] : ['/licenses'];
  if (useClusterPath) {
    return ['/api/oil-live/licenses/map', '/api/oil-live/licenses', ...pythonFallback];
  }
  return ['/api/oil-live/licenses', ...pythonFallback];
}

/** Per-country hubs for world/regional zoom (z &lt; SERVER_CLUSTER_MIN_DRILL_ZOOM). */
export function licenseCountrySummaryFetchPaths(): string[] {
  if (!LICENSE_MAP_GO_ENABLED) return [];
  return ['/api/oil-live/licenses/country-summary', '/api/licenses/country-summary'];
}

export function clusterTargetZoom(currentZoom: number): number {
  return Math.min(Math.max(currentZoom + 2, SERVER_CLUSTER_MIN_DRILL_ZOOM), 13);
}

export type ClusterDrillFlyPlan =
  | { mode: 'center'; zoom: number }
  | { mode: 'bounds'; maxZoom: number };

/** Pick center fly when bounds are too wide to reach drill zoom via fit-bounds alone. */
export function planClusterDrillFly(
  currentZoom: number,
  boundsSpanDeg: number,
  boundsFitZoom: number | null,
): ClusterDrillFlyPlan {
  const targetZoom = clusterTargetZoom(currentZoom);
  const fitZoom = boundsFitZoom ?? 0;
  if (
    boundsSpanDeg > 2.5 ||
    fitZoom < SERVER_CLUSTER_MIN_DRILL_ZOOM ||
    currentZoom < 5
  ) {
    return { mode: 'center', zoom: targetZoom };
  }
  return { mode: 'bounds', maxZoom: Math.min(14, Math.max(targetZoom + 1, fitZoom)) };
}

/** Leaflet bounds for flying into a server grid cell (degrees). */
export function serverClusterFlyBounds(
  lat: number,
  lng: number,
  item: MiningLicense,
): { south: number; west: number; north: number; east: number } {
  const pad = clusterExpandPaddingDeg(item);
  return {
    south: lat - pad,
    west: lng - pad,
    north: lat + pad,
    east: lng + pad,
  };
}

export function shouldRenderServerLicenseCluster(item: MiningLicense): boolean {
  const n = item.mapClusterCount ?? 0;
  return n >= MIN_SERVER_LICENSE_CLUSTER_COUNT;
}
