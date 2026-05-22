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

export function clusterTargetZoom(currentZoom: number): number {
  return Math.max(Math.min(currentZoom + 3, 12), 9);
}

export function shouldRenderServerLicenseCluster(item: MiningLicense): boolean {
  const n = item.mapClusterCount ?? 0;
  return n >= MIN_SERVER_LICENSE_CLUSTER_COUNT;
}
