import { useCallback, useState } from 'react';
import type L from 'leaflet';
import type { MiningLicense } from '../../types';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import { isLiveDealClientClusterData } from '../../lib/liveDealMap/liveDealMapLod';
import { isServerLicenseCluster } from '../../lib/licenseMapCluster';

type UseLicenseInteractionsArgs<TPending extends MiningLicense> = {
  mapDisplayData: MiningLicense[];
  markerRefs: React.MutableRefObject<Record<string, L.Marker>>;
  onSelectMaritimeVessel: (vessel: null) => void;
  setSelectedItem: (item: MiningLicense | null) => void;
  buildClientClusterFly: (feature: LiveDealMapFeature) => TPending;
};

export function useLicenseInteractions<TPending extends MiningLicense>({
  mapDisplayData,
  markerRefs,
  onSelectMaritimeVessel,
  setSelectedItem,
  buildClientClusterFly,
}: UseLicenseInteractionsArgs<TPending>) {
  const [pendingLicenseClusterFly, setPendingLicenseClusterFly] = useState<TPending | null>(null);

  const handleLicenseMarkerClick = useCallback(
    (item: MiningLicense, isServerCluster: boolean) => {
      onSelectMaritimeVessel(null);
      if (isServerCluster) {
        setSelectedItem(null);
        setPendingLicenseClusterFly(item as TPending);
        return;
      }
      setSelectedItem(item);
    },
    [onSelectMaritimeVessel, setSelectedItem],
  );

  const handleLicenseCanvasFeatureClick = useCallback(
    (feature: LiveDealMapFeature) => {
      if (
        feature.shape === 'point' &&
        feature.kind === 'server_cluster' &&
        isLiveDealClientClusterData(feature.data)
      ) {
        onSelectMaritimeVessel(null);
        setSelectedItem(null);
        setPendingLicenseClusterFly(buildClientClusterFly(feature));
        return;
      }
      const item = feature.data as MiningLicense | undefined;
      if (!item) return;
      onSelectMaritimeVessel(null);
      setSelectedItem(item);
    },
    [buildClientClusterFly, onSelectMaritimeVessel, setSelectedItem],
  );

  const handleSingleClusterMarkerClick = useCallback(
    (marker: L.Marker) => {
      const ll = marker.getLatLng();
      const byRef = Object.entries(markerRefs.current).find(([, m]) => m === marker)?.[0];
      const item =
        (byRef ? mapDisplayData.find((d) => d.id === byRef) : null) ??
        mapDisplayData.find((d) => {
          const lat = d._displayLat ?? d.lat;
          const lng = d._displayLng ?? d.lng;
          if (lat == null || lng == null) return false;
          return Math.abs(lat - ll.lat) < 1e-4 && Math.abs(lng - ll.lng) < 1e-4;
        });
      if (!item) return;
      onSelectMaritimeVessel(null);
      if (isServerLicenseCluster(item)) {
        setSelectedItem(null);
        setPendingLicenseClusterFly(item as TPending);
        return;
      }
      setSelectedItem(item);
    },
    [mapDisplayData, markerRefs, onSelectMaritimeVessel, setSelectedItem],
  );

  return {
    pendingLicenseClusterFly,
    setPendingLicenseClusterFly,
    handleLicenseMarkerClick,
    handleLicenseCanvasFeatureClick,
    handleSingleClusterMarkerClick,
  };
}
