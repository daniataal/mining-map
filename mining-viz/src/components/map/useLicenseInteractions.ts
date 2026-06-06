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
  onPrepareClusterDrill?: (item: MiningLicense) => void;
  /** When false, apply side-effects but skip scheduling a map fly (e.g. country hub already drilled). */
  shouldScheduleClusterDrill?: (item: MiningLicense) => boolean;
  /** Grid cluster click — open Intelligence rail (Global › Licenses). */
  onLicenseClusterSelect?: (item: MiningLicense) => void;
};

export function useLicenseInteractions<TPending extends MiningLicense>({
  mapDisplayData,
  markerRefs,
  onSelectMaritimeVessel,
  setSelectedItem,
  buildClientClusterFly,
  onPrepareClusterDrill,
  shouldScheduleClusterDrill,
  onLicenseClusterSelect,
}: UseLicenseInteractionsArgs<TPending>) {
  const [pendingLicenseClusterFly, setPendingLicenseClusterFly] = useState<TPending | null>(null);

  const handleLicenseMarkerClick = useCallback(
    (item: MiningLicense, isServerCluster: boolean) => {
      onSelectMaritimeVessel(null);
      if (isServerCluster) {
        onPrepareClusterDrill?.(item);
        onLicenseClusterSelect?.(item);
        if (shouldScheduleClusterDrill && !shouldScheduleClusterDrill(item)) {
          return;
        }
        setSelectedItem(null);
        setPendingLicenseClusterFly(item as TPending);
        return;
      }
      setSelectedItem(item);
    },
    [onSelectMaritimeVessel, onPrepareClusterDrill, onLicenseClusterSelect, shouldScheduleClusterDrill, setSelectedItem],
  );

  const handleLicenseCanvasFeatureClick = useCallback(
    (feature: LiveDealMapFeature) => {
      if (
        feature.shape === 'point' &&
        feature.kind === 'server_cluster' &&
        isLiveDealClientClusterData(feature.data)
      ) {
        onSelectMaritimeVessel(null);
        const pending = buildClientClusterFly(feature);
        onLicenseClusterSelect?.(pending);
        setSelectedItem(null);
        setPendingLicenseClusterFly(pending);
        return;
      }
      const item = feature.data as MiningLicense | undefined;
      if (!item) return;
      onSelectMaritimeVessel(null);
      setSelectedItem(item);
    },
    [buildClientClusterFly, onLicenseClusterSelect, onSelectMaritimeVessel, setSelectedItem],
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
        onPrepareClusterDrill?.(item);
        onLicenseClusterSelect?.(item);
        if (shouldScheduleClusterDrill && !shouldScheduleClusterDrill(item)) {
          return;
        }
        setSelectedItem(null);
        setPendingLicenseClusterFly(item as TPending);
        return;
      }
      setSelectedItem(item);
    },
    [mapDisplayData, markerRefs, onPrepareClusterDrill, onLicenseClusterSelect, shouldScheduleClusterDrill, onSelectMaritimeVessel, setSelectedItem],
  );

  return {
    pendingLicenseClusterFly,
    setPendingLicenseClusterFly,
    handleLicenseMarkerClick,
    handleLicenseCanvasFeatureClick,
    handleSingleClusterMarkerClick,
  };
}
