import type { LegacyViewMode } from './intelligenceModes';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

export type AssetLayerId =
  | 'mines'
  | 'oil_fields'
  | 'refineries'
  | 'tank_farms'
  | 'ports'
  | 'pipelines'
  | 'lng'
  | 'ais_vessels'
  | 'country_borders'
  | 'esg_zones';

export type AssetLayerVisibility = Record<AssetLayerId, boolean>;

export type AssetLayerPresetId = 'overview' | 'mining' | 'oil_logistics' | 'port_export' | 'clean';

export const CORE_ASSET_LAYER_IDS: readonly AssetLayerId[] = [
  'mines',
  'oil_fields',
  'refineries',
  'tank_farms',
  'ports',
] as const;

export const OPTIONAL_ASSET_LAYER_IDS: readonly AssetLayerId[] = [
  'pipelines',
  'lng',
  'ais_vessels',
  'country_borders',
  'esg_zones',
] as const;

export const DEFAULT_ASSET_LAYER_VISIBILITY: AssetLayerVisibility = {
  mines: true,
  oil_fields: true,
  refineries: true,
  tank_farms: true,
  ports: true,
  pipelines: true,
  lng: true,
  ais_vessels: false,
  country_borders: true,
  esg_zones: true,
};

export const ASSET_LAYER_PRESETS: Record<AssetLayerPresetId, AssetLayerVisibility> = {
  overview: {
    ...DEFAULT_ASSET_LAYER_VISIBILITY,
  },
  mining: {
    ...DEFAULT_ASSET_LAYER_VISIBILITY,
    mines: true,
    oil_fields: false,
    refineries: false,
    tank_farms: false,
    ports: false,
    pipelines: false,
    lng: false,
    ais_vessels: false,
    esg_zones: true,
  },
  oil_logistics: {
    ...DEFAULT_ASSET_LAYER_VISIBILITY,
    mines: false,
    oil_fields: true,
    refineries: true,
    tank_farms: true,
    ports: false,
    pipelines: true,
    lng: false,
    ais_vessels: false,
    esg_zones: true,
  },
  port_export: {
    ...DEFAULT_ASSET_LAYER_VISIBILITY,
    mines: false,
    oil_fields: false,
    refineries: false,
    tank_farms: true,
    ports: true,
    pipelines: false,
    lng: true,
    ais_vessels: true,
    esg_zones: true,
  },
  clean: {
    ...DEFAULT_ASSET_LAYER_VISIBILITY,
    mines: false,
    oil_fields: false,
    refineries: false,
    tank_farms: false,
    ports: false,
    pipelines: false,
    lng: false,
    ais_vessels: false,
    country_borders: true,
    esg_zones: false,
  },
};

export type AssetsPetroleumLayerPrefs = {
  showOsmPetroleum: boolean;
  osmLayerIds: OsmPetroleumLayerId[];
  osmLayerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  osmForcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  splitOilGasPipelineLayers: boolean;
  showGemPipelines: boolean;
  showGemPlants: boolean;
  showGemLng: boolean;
  showStorageTankFarms: boolean;
};

export function toggleAssetLayer(
  visibility: AssetLayerVisibility,
  layerId: AssetLayerId,
): AssetLayerVisibility {
  return { ...visibility, [layerId]: !visibility[layerId] };
}

export function applyAssetLayerPreset(presetId: AssetLayerPresetId): AssetLayerVisibility {
  return { ...ASSET_LAYER_PRESETS[presetId] };
}

export function activeAssetLayerCount(visibility: AssetLayerVisibility): number {
  return CORE_ASSET_LAYER_IDS.reduce((count, id) => count + (visibility[id] ? 1 : 0), 0);
}

export function assetLicenseMarkersEnabled(visibility: AssetLayerVisibility): boolean {
  return visibility.mines || visibility.oil_fields;
}

export function resolveAssetLicenseSector(
  visibility: AssetLayerVisibility,
): 'mining' | 'oil_and_gas' | undefined {
  const mining = visibility.mines;
  const oil = visibility.oil_fields;
  if (mining && !oil) return 'mining';
  if (oil && !mining) return 'oil_and_gas';
  return undefined;
}

export function resolveAssetMapViewKey(visibility: AssetLayerVisibility): LegacyViewMode {
  if (
    visibility.oil_fields ||
    visibility.refineries ||
    visibility.tank_farms ||
    visibility.pipelines ||
    visibility.lng
  ) {
    return 'oil_and_gas';
  }
  if (visibility.ports && !visibility.mines) return 'ports';
  return 'mining';
}

export function assetsPetroleumLayerPrefsFromVisibility(
  visibility: AssetLayerVisibility | null | undefined,
): AssetsPetroleumLayerPrefs {
  const v = visibility ?? DEFAULT_ASSET_LAYER_VISIBILITY;
  const osmLayerIds: OsmPetroleumLayerId[] = [];
  const osmLayerVisibility: Partial<Record<OsmPetroleumLayerId, boolean>> = {
    pipelines: Boolean(v.pipelines),
    refineries: Boolean(v.refineries),
    storage_terminals: Boolean(v.tank_farms),
  };
  const osmForcedLayers: Partial<Record<OsmPetroleumLayerId, boolean>> = {};

  if (v.pipelines) {
    osmLayerIds.push('pipelines');
    osmForcedLayers.pipelines = true;
  }
  if (v.refineries) {
    osmLayerIds.push('refineries');
    osmForcedLayers.refineries = true;
  }
  if (v.tank_farms) {
    osmLayerIds.push('storage_terminals');
    osmForcedLayers.storage_terminals = true;
  }

  return {
    showOsmPetroleum: osmLayerIds.length > 0,
    osmLayerIds,
    osmLayerVisibility,
    osmForcedLayers,
    splitOilGasPipelineLayers: Boolean(v.pipelines),
    showGemPipelines: Boolean(v.pipelines),
    showGemPlants: Boolean(v.refineries),
    showGemLng: Boolean(v.lng),
    showStorageTankFarms: Boolean(v.tank_farms),
  };
}
