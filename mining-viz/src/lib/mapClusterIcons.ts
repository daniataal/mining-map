import L from 'leaflet';

export type ClusterIconFactory = (cluster: { getChildCount: () => number }) => L.DivIcon;

/** Theme-aware license marker cluster bubbles (Leaflet MarkerClusterGroup). */
export function createLicenseClusterIconFactory(isDark: boolean): ClusterIconFactory {
  return (cluster) => {
    const count = cluster.getChildCount();
    const size = count < 10 ? 36 : count < 100 ? 44 : 52;
    const className = isDark ? 'custom-cluster-icon' : 'custom-cluster-icon custom-cluster-icon--light';
    return L.divIcon({
      html: `<span>${count}</span>`,
      className,
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
