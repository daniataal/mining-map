import { useMemo } from 'react';
import type L from 'leaflet';
import type { MiningLicense, UserAnnotation } from '../../types';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import { isServerLicenseCluster } from '../../lib/licenseMapCluster';
import { isRefineryEntity, isOilFieldEntity } from '../../lib/oilEntityKinds';
import { getEsgZoneIntersection } from '../../lib/esgConservationZones';
import { createRefineryMapIcon, createOilFieldMapIcon } from '../petroleum/refineryMapIcon';
import {
  createLicenseClusterIconFactory,
  createServerLicenseClusterIcon,
} from '../../lib/mapClusterIcons';
import { markerIconSignature } from '../../lib/licenseMarkerIconCache';

type UseLicenseMarkerVisualsArgs = {
  mapDisplayData: MiningLicense[];
  showLicenseMarkers: boolean;
  useCanvasLicenseMarkers: boolean;
  licenseServerClusterMode: boolean;
  userAnnotations: Record<string, UserAnnotation>;
  isDark: boolean;
  markerIconCache: {
    get(id: string, signature: string, factory: () => L.DivIcon): L.DivIcon;
    prune(validIds: Set<string>): void;
  };
  getMarkerColor: (
    commodity: string | null | undefined,
    status?: string | null,
    sector?: string | null,
    entitySubtype?: string | null,
  ) => string;
  createCustomIcon: (
    color: string,
    isHovered: boolean,
    isEsgRisk: boolean | undefined,
    isDark: boolean,
  ) => L.DivIcon;
};

export function useLicenseMarkerVisuals({
  mapDisplayData,
  showLicenseMarkers,
  useCanvasLicenseMarkers,
  licenseServerClusterMode,
  userAnnotations,
  isDark,
  markerIconCache,
  getMarkerColor,
  createCustomIcon,
}: UseLicenseMarkerVisualsArgs) {
  const licenseCanvasFeatures = useMemo<LiveDealMapFeature[]>(() => {
    if (!showLicenseMarkers || !useCanvasLicenseMarkers || licenseServerClusterMode) return [];
    return mapDisplayData
      .filter((item) => item._displayLat != null && item._displayLng != null)
      .map((item) => {
        const annotation = userAnnotations[item.id] || {};
        const commodity = annotation.commodity || item.commodity || '';
        const color = getMarkerColor(
          commodity,
          annotation.status,
          item.sector,
          item.entitySubtype,
        );
        const refineryPin = isRefineryEntity(item);
        const oilFieldPin = !refineryPin && isOilFieldEntity(item);
        const kind =
          item.entitySubtype === 'tank_farm'
            ? 'tank_farm'
            : item.entityKind === 'storage_terminal' ||
                item.entitySubtype === 'storage_terminal' ||
                item.entitySubtype === 'storage_tank'
              ? 'storage_terminal'
              : refineryPin
                ? 'refinery'
                : oilFieldPin
                  ? 'oil_field'
                  : 'license';
        return {
          shape: 'point',
          uid: `license:${item.id}`,
          id: item.id,
          kind,
          lat: item._displayLat!,
          lng: item._displayLng!,
          title: item.company,
          subtitle: [item.commodity, item.country, item.licenseType].filter(Boolean).join(' · '),
          tier: item.recordOrigin ?? item.sourceKind ?? 'open_data',
          confidence: item.confidenceScore ?? item.geoConfidence ?? undefined,
          sourceCount: item.evidenceCount ?? item.sourceLabels?.length ?? 0,
          dealScore:
            item.confidenceScore ??
            (item.status?.toLowerCase?.().includes('operat') ? 0.75 : 0.5),
          styleKey:
            commodity.toLowerCase().includes('gold')
              ? 'gold'
              : refineryPin
                ? 'refinery'
                : oilFieldPin
                  ? 'oil_field'
                  : item.entitySubtype ?? color,
          data: item,
        } satisfies LiveDealMapFeature;
      });
  }, [
    licenseServerClusterMode,
    mapDisplayData,
    showLicenseMarkers,
    useCanvasLicenseMarkers,
    userAnnotations,
    getMarkerColor,
  ]);

  const licenseMarkerIcons = useMemo(() => {
    const icons = new Map<string, L.DivIcon>();
    const validIds = new Set<string>();
    for (const item of mapDisplayData) {
      if (item._displayLat == null || item._displayLng == null) continue;
      if (useCanvasLicenseMarkers && !isServerLicenseCluster(item)) continue;
      validIds.add(item.id);
      const annotation = userAnnotations[item.id] || {};
      const color = getMarkerColor(
        annotation.commodity || item.commodity,
        annotation.status,
        item.sector,
        item.entitySubtype,
      );
      const esgZone = getEsgZoneIntersection(item._displayLat, item._displayLng);
      const isEsgRisk = esgZone !== null;
      const refineryPin = isRefineryEntity(item);
      const oilFieldPin = !refineryPin && isOilFieldEntity(item);
      const clusterCount = item.mapClusterCount ?? 0;
      const sig = clusterCount
        ? `srv-cluster:${clusterCount}:${isDark ? 'd' : 'l'}`
        : markerIconSignature(color, isEsgRisk, refineryPin, oilFieldPin, isDark);
      icons.set(
        item.id,
        markerIconCache.get(item.id, sig, () =>
          clusterCount > 0
            ? createServerLicenseClusterIcon(clusterCount, isDark)
            : refineryPin
              ? createRefineryMapIcon()
              : oilFieldPin
                ? createOilFieldMapIcon()
                : createCustomIcon(color, false, isEsgRisk, isDark),
        ),
      );
    }
    markerIconCache.prune(validIds);
    return icons;
  }, [
    mapDisplayData,
    userAnnotations,
    isDark,
    useCanvasLicenseMarkers,
    markerIconCache,
    getMarkerColor,
    createCustomIcon,
  ]);

  const licenseClusterIconCreate = useMemo(
    () => createLicenseClusterIconFactory(isDark),
    [isDark],
  );

  return {
    licenseCanvasFeatures,
    licenseMarkerIcons,
    licenseClusterIconCreate,
  };
}
