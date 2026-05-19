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
