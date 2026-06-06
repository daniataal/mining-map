import type { AssetsSublayer, IntelligenceMode, IntelligenceSublayer } from './intelligenceModes';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

export type AssetsMapLens = AssetsSublayer;

/** Active Assets cockpit lens, or null when not in Assets mode. */
export function assetsMapLens(
  mode: IntelligenceMode,
  sublayer: IntelligenceSublayer,
): AssetsMapLens | null {
  if (mode !== 'assets') return null;
  return sublayer as AssetsMapLens;
}

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

const DEFAULT_PETROLEUM_PREFS: AssetsPetroleumLayerPrefs = {
  showOsmPetroleum: true,
  osmLayerIds: ['pipelines', 'refineries'],
  splitOilGasPipelineLayers: true,
  showGemPipelines: true,
  showGemPlants: true,
  showGemLng: true,
  showStorageTankFarms: true,
};

/** Layer emphasis for Assets › oil_fields | refineries | tank_farms (legacy oil_and_gas uses defaults). */
export function assetsPetroleumLayerPrefs(lens: AssetsMapLens | null): AssetsPetroleumLayerPrefs {
  if (!lens || lens === 'mines' || lens === 'ports') return DEFAULT_PETROLEUM_PREFS;

  switch (lens) {
    case 'oil_fields':
      return {
        showOsmPetroleum: true,
        osmLayerIds: ['pipelines'],
        osmLayerVisibility: { pipelines: true, refineries: false, storage_terminals: false },
        osmForcedLayers: { pipelines: true },
        splitOilGasPipelineLayers: true,
        showGemPipelines: true,
        showGemPlants: false,
        showGemLng: false,
        showStorageTankFarms: false,
      };
    case 'refineries':
      return {
        showOsmPetroleum: true,
        osmLayerIds: ['refineries'],
        osmLayerVisibility: { pipelines: false, refineries: true, storage_terminals: false },
        osmForcedLayers: { refineries: true },
        splitOilGasPipelineLayers: false,
        showGemPipelines: false,
        showGemPlants: true,
        showGemLng: false,
        showStorageTankFarms: false,
      };
    case 'tank_farms':
      return {
        showOsmPetroleum: true,
        osmLayerIds: ['storage_terminals'],
        osmLayerVisibility: { pipelines: false, refineries: false, storage_terminals: true },
        osmForcedLayers: { storage_terminals: true },
        splitOilGasPipelineLayers: false,
        showGemPipelines: false,
        showGemPlants: false,
        showGemLng: false,
        showStorageTankFarms: true,
      };
  }
}

export function assetsMapLensHelperCopy(lens: AssetsMapLens): { en: string; he: string } {
  switch (lens) {
    case 'mines':
      return { en: 'Mining licenses & cadastre', he: 'רישיונות כרייה' };
    case 'oil_fields':
      return { en: 'Upstream blocks, pipelines & extraction', he: 'בלוקים, צינורות וייצור' };
    case 'refineries':
      return { en: 'Refineries & processing plants (OSM + GEM)', he: 'זיקוק ומתקני עיבוד (OSM + GEM)' };
    case 'tank_farms':
      return { en: 'Storage terminals & tank farms (OSM + reference)', he: 'מסופי אחסון וטנקים (OSM + מקורות)' };
    case 'ports':
      return { en: 'Port authorities & maritime hubs', he: 'רשויות נמל ומרכזי ימי' };
  }
}
