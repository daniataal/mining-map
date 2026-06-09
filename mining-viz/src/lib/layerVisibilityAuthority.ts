import type { LegacyViewMode } from './intelligenceModes';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';
import {
  type AssetLayerVisibility,
  type AssetsPetroleumLayerPrefs,
  assetLicenseMarkersEnabled,
  assetsPetroleumLayerPrefsFromVisibility,
  resolveAssetMapViewKey,
} from './assetLayerCockpit';

export type EffectiveLayerGates = {
  viewModeKey: LegacyViewMode;
  shouldFetchLicenses: boolean;
  shouldMountLicenseMarkers: boolean;
  shouldFetchBunkerSuppliers: boolean;
  shouldFetchStorageTerminals: boolean;
  shouldMountMaritime: boolean;
  /** OSM/GEM infrastructure chrome and fetches — gated off when asset cockpit petroleum is all-off. */
  shouldMountInfrastructure: boolean;
  petroleumPrefs: AssetsPetroleumLayerPrefs;
  osmLayerEnabled: (layerId: OsmPetroleumLayerId) => boolean;
};

export function petroleumAssetLayersActive(visibility: AssetLayerVisibility): boolean {
  return (
    visibility.oil_fields ||
    visibility.refineries ||
    visibility.plants ||
    visibility.tank_farms ||
    visibility.pipelines ||
    visibility.lng ||
    visibility.bunker_suppliers
  );
}

export function resolveEffectiveLayers(input: {
  assetVisibility: AssetLayerVisibility;
  viewMode: LegacyViewMode;
  assetCockpitActive: boolean;
  bunkerRegistryOpen?: boolean;
  licenseMapFetchEnabled?: boolean;
  routePlannerPipelinesMode?: boolean;
}): EffectiveLayerGates {
  const {
    assetVisibility,
    viewMode,
    assetCockpitActive,
    bunkerRegistryOpen = false,
    routePlannerPipelinesMode = false,
  } = input;
  const petroleumActive = petroleumAssetLayersActive(assetVisibility);
  const prefs = assetsPetroleumLayerPrefsFromVisibility(assetVisibility);

  let viewModeKey = viewMode;
  if (assetCockpitActive) {
    if (petroleumActive) {
      viewModeKey = 'oil_and_gas';
    } else if (assetVisibility.ports && !assetVisibility.mines) {
      viewModeKey = 'ports';
    } else if (!assetVisibility.mines && !assetVisibility.ports) {
      viewModeKey = 'oil_and_gas';
    } else {
      viewModeKey = resolveAssetMapViewKey(assetVisibility);
    }
  }

  const licenseMarkers =
    assetCockpitActive
      ? assetLicenseMarkersEnabled(assetVisibility)
      : viewMode === 'mining' || viewMode === 'global' || viewMode === 'oil_and_gas';

  const shouldFetchLicenses =
    input.licenseMapFetchEnabled !== false &&
    licenseMarkers &&
    (viewModeKey === 'mining' || viewModeKey === 'global' || viewModeKey === 'oil_and_gas');

  const shouldFetchBunkerSuppliers =
    assetVisibility.bunker_suppliers || bunkerRegistryOpen;

  const shouldFetchStorageTerminals =
    assetVisibility.tank_farms && viewModeKey === 'oil_and_gas';

  const shouldMountMaritime = assetVisibility.ais_vessels;

  const shouldMountInfrastructure =
    routePlannerPipelinesMode ||
    viewModeKey === 'mining' ||
    viewModeKey === 'global' ||
    (viewModeKey === 'oil_and_gas' && (!assetCockpitActive || petroleumActive));

  const osmVisibility = prefs.osmLayerVisibility ?? {};

  return {
    viewModeKey,
    shouldFetchLicenses,
    shouldMountLicenseMarkers: licenseMarkers,
    shouldFetchBunkerSuppliers,
    shouldFetchStorageTerminals,
    shouldMountMaritime,
    shouldMountInfrastructure,
    petroleumPrefs: {
      ...prefs,
      osmForcedLayers: {},
      showOsmPetroleum: prefs.showOsmPetroleum,
      showGemPipelines: prefs.showGemPipelines && assetVisibility.pipelines,
      showGemPlants: prefs.showGemPlants && assetVisibility.plants,
      showGemLng: prefs.showGemLng && assetVisibility.lng,
      showStorageTankFarms: prefs.showStorageTankFarms && assetVisibility.tank_farms,
      showBunkerSuppliers: prefs.showBunkerSuppliers && assetVisibility.bunker_suppliers,
    },
    osmLayerEnabled: (layerId: OsmPetroleumLayerId) => Boolean(osmVisibility[layerId]),
  };
}
