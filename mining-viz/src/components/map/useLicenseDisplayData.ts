import { useMemo } from 'react';
import type { MiningLicense, MaritimeViewportBounds } from '../../types';
import { capMarkersInViewport } from '../../lib/mapDomMarkerCap';
import { LICENSE_MAP_DOM_MARKER_CAP } from '../../lib/mapViewportDebounce';
import { isServerLicenseCluster } from '../../lib/licenseMapCluster';

const PORTS_MAP_RENDER_LIMIT = 3000;

type UseLicenseDisplayDataArgs = {
  displayData: MiningLicense[];
  selectedItem: MiningLicense | null;
  viewModeKey: string;
  isMobileDevice: boolean;
  currentVisibleViewport: MaritimeViewportBounds | null;
  licenseViewport: MaritimeViewportBounds | null;
  showLicenseMarkers: boolean;
  useCanvasLicenseMarkers: boolean;
};

export function useLicenseDisplayData({
  displayData,
  selectedItem,
  viewModeKey,
  isMobileDevice,
  currentVisibleViewport,
  licenseViewport,
  showLicenseMarkers,
  useCanvasLicenseMarkers,
}: UseLicenseDisplayDataArgs) {
  const { mapDisplayData, licenseMarkersCapped } = useMemo(() => {
    let data = displayData;

    if (viewModeKey === 'ports' && data.length > PORTS_MAP_RENDER_LIMIT) {
      const capped = data.slice(0, PORTS_MAP_RENDER_LIMIT);
      if (selectedItem) {
        const selected = displayData.find((item) => item.id === selectedItem.id);
        if (selected && !capped.some((item) => item.id === selected.id)) {
          data = [selected, ...capped.slice(0, PORTS_MAP_RENDER_LIMIT - 1)];
        } else {
          data = capped;
        }
      } else {
        data = capped;
      }
    }

    const serverClusterMode = data.some(isServerLicenseCluster);
    if (
      showLicenseMarkers &&
      !useCanvasLicenseMarkers &&
      !serverClusterMode &&
      data.length > LICENSE_MAP_DOM_MARKER_CAP
    ) {
      const markerViewport = isMobileDevice ? currentVisibleViewport : licenseViewport;
      const capped = capMarkersInViewport(
        data,
        markerViewport,
        LICENSE_MAP_DOM_MARKER_CAP,
        selectedItem?.id,
      );
      return { mapDisplayData: capped.data, licenseMarkersCapped: capped.capped };
    }

    return { mapDisplayData: data, licenseMarkersCapped: false };
  }, [
    displayData,
    selectedItem,
    viewModeKey,
    isMobileDevice,
    currentVisibleViewport,
    licenseViewport,
    showLicenseMarkers,
    useCanvasLicenseMarkers,
  ]);

  const licenseServerClusterMode = useMemo(
    () => mapDisplayData.some(isServerLicenseCluster),
    [mapDisplayData],
  );

  return {
    mapDisplayData,
    licenseMarkersCapped,
    licenseServerClusterMode,
  };
}
