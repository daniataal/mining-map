import type { MiningLicense } from '../types';

/** Ignore singleton server grid cells (backend should omit; safety net). */
export const MIN_SERVER_LICENSE_CLUSTER_COUNT = 2;

/** Server-side viewport aggregate (not a real license row). */
export function isServerLicenseCluster(item: MiningLicense | null | undefined): boolean {
  if (!item) return false;
  if ((item.mapClusterCount ?? 0) > 0) return true;
  if (item.id.startsWith('cluster:')) return true;
  return item.licenseType === 'Cluster';
}

/** Bbox padding (degrees) to refetch individual licenses after zooming into a cluster. */
export function clusterExpandPaddingDeg(item: MiningLicense): number {
  const grid = item.mapClusterGridDeg;
  if (grid != null && grid > 0) return Math.max(0.25, grid * 0.55);
  const n = item.mapClusterCount ?? 10;
  if (n > 150) return 1.0;
  if (n > 40) return 0.55;
  return 0.35;
}

/** Match MapComponent default zoom for license views (must align API zoom with map). */
export const LICENSE_MAP_DEFAULT_ZOOM = 7;

/** Server grid mode ends below this zoom (matches backend license_grid_degrees z >= 7). */
export const SERVER_CLUSTER_MIN_DRILL_ZOOM = 7;

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
