import L from 'leaflet';
import { clusterIconSizeForTier, clusterTierForCount } from './clusterTier';

export type ClusterIconFactory = (cluster: { getChildCount: () => number }) => L.DivIcon;

function clusterClassName(count: number, isDark: boolean, server = false): string {
  const tier = clusterTierForCount(count);
  const base = isDark ? 'custom-cluster-icon' : 'custom-cluster-icon custom-cluster-icon--light';
  const tierClass = `custom-cluster-icon--${tier}`;
  const serverClass = server ? ' custom-cluster-icon--server' : '';
  return `${base} ${tierClass}${serverClass}`;
}

/** Pre-aggregated grid cell from GET /licenses?zoom&lt;8 (server cluster). */
export function createServerLicenseClusterIcon(count: number, isDark: boolean): L.DivIcon {
  const tier = clusterTierForCount(count);
  const size = clusterIconSizeForTier(tier);
  return L.divIcon({
    html: `<span>${count}</span>`,
    className: clusterClassName(count, isDark, true),
    iconSize: L.point(size, size),
  });
}

/** Theme-aware license marker cluster bubbles (Leaflet MarkerClusterGroup). */
export function createLicenseClusterIconFactory(isDark: boolean): ClusterIconFactory {
  return (cluster) => {
    const count = cluster.getChildCount();
    const tier = clusterTierForCount(count);
    const size = clusterIconSizeForTier(tier);
    return L.divIcon({
      html: `<span>${count}</span>`,
      className: clusterClassName(count, isDark),
      iconSize: L.point(size, size),
    });
  };
}

/** Blue terminal clusters for oil-live map overlays. */
export function createOilTerminalClusterIconFactory(): ClusterIconFactory {
  return (cluster) => {
    const count = cluster.getChildCount();
    const size = count < 10 ? 32 : count < 50 ? 38 : 44;
    return L.divIcon({
      html: `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:11px;font-weight:900;color:#fff">${count}</span>`,
      className: 'oil-terminal-cluster-icon',
      iconSize: L.point(size, size),
    });
  };
}
