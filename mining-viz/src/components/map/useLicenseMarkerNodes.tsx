import { useMemo, type ReactNode } from 'react';
import L from 'leaflet';
import { Marker, Tooltip } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { isCountryLicenseSummary } from '../../lib/licenseCountrySummary';
import {
  isServerLicenseCluster,
  SERVER_CLUSTER_MIN_DRILL_ZOOM,
} from '../../lib/licenseMapCluster';

type UseLicenseMarkerNodesArgs = {
  mapDisplayData: MiningLicense[];
  showLicenseMarkers: boolean;
  licenseMarkerIcons: Map<string, L.DivIcon>;
  licenseMapZoom?: number;
  licenseServerClusterMode: boolean;
  markerRefs: React.MutableRefObject<Record<string, L.Marker>>;
  onMarkerClick: (item: MiningLicense, isServerCluster: boolean) => void;
};

export function useLicenseMarkerNodes({
  mapDisplayData,
  showLicenseMarkers,
  licenseMarkerIcons,
  licenseMapZoom,
  licenseServerClusterMode,
  markerRefs,
  onMarkerClick,
}: UseLicenseMarkerNodesArgs) {
  return useMemo(() => {
    if (!showLicenseMarkers) {
      return { serverClusterMarkers: null as ReactNode, licensePointMarkers: null as ReactNode };
    }
    const server: ReactNode[] = [];
    const points: ReactNode[] = [];
    const serverClusterMode = licenseServerClusterMode;
    for (const item of mapDisplayData) {
      if (item._displayLat == null || item._displayLng == null) continue;
      const markerIcon = licenseMarkerIcons.get(item.id);
      if (!markerIcon) continue;
      const isServerCluster = isServerLicenseCluster(item);
      const hideCountrySummaryHub =
        isCountryLicenseSummary(item) &&
        licenseMapZoom != null &&
        licenseMapZoom >= SERVER_CLUSTER_MIN_DRILL_ZOOM;
      if (hideCountrySummaryHub) continue;
      const hidePointsForServerClusters =
        serverClusterMode &&
        (licenseMapZoom == null || licenseMapZoom < SERVER_CLUSTER_MIN_DRILL_ZOOM);
      if (!isServerCluster && hidePointsForServerClusters) continue;
      const marker = (
        <Marker
          key={item.id}
          position={[item._displayLat, item._displayLng]}
          icon={markerIcon}
          zIndexOffset={isServerCluster ? 1200 : 0}
          ref={(el) => {
            if (!el) {
              delete markerRefs.current[item.id];
              return;
            }
            markerRefs.current[item.id] = el;
          }}
          eventHandlers={{
            click: (e) => {
              const oe = e.originalEvent as MouseEvent & { __mapFeatureClickHandled?: boolean };
              if (oe) oe.__mapFeatureClickHandled = true;
              L.DomEvent.stopPropagation(e);
              onMarkerClick(item, isServerCluster);
            },
          }}
        >
          {isServerCluster ? (
            <Tooltip direction="top" offset={[0, -20]} opacity={1}>
              <div className="bg-slate-950 border border-white/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                <span className="text-[10px] font-black uppercase text-white tracking-widest">
                  {isCountryLicenseSummary(item)
                    ? `${item.country} — ${item.mapClusterCount ?? ''} licenses`
                    : `Zoom in — ${item.mapClusterCount ?? ''} licenses`}
                </span>
              </div>
            </Tooltip>
          ) : (
            <Tooltip direction="top" offset={[0, -20]} opacity={1}>
              <div className="bg-slate-950 border border-white/20 px-2 py-1 rounded-md shadow-2xl backdrop-blur-md">
                <span className="text-[10px] font-black uppercase text-white tracking-widest">
                  {item.company}
                </span>
                {item.entitySubtype && (
                  <p className="text-[8px] text-cyan-300 uppercase tracking-widest">
                    {item.entitySubtype.replaceAll('_', ' ')}
                  </p>
                )}
                {item._wasJittered && (
                  <span className="ml-1 text-[8px] font-bold text-amber-400">
                    ≈ approx ({item._collocatedCount})
                  </span>
                )}
              </div>
            </Tooltip>
          )}
        </Marker>
      );
      if (isServerCluster) server.push(marker);
      else points.push(marker);
    }
    return {
      serverClusterMarkers: server.length ? server : null,
      licensePointMarkers: points.length ? points : null,
    };
  }, [
    licenseMarkerIcons,
    licenseMapZoom,
    licenseServerClusterMode,
    mapDisplayData,
    markerRefs,
    onMarkerClick,
    showLicenseMarkers,
  ]);
}
