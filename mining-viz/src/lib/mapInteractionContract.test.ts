import { describe, expect, it } from 'vitest';
import {
  storageClusterParseMaxZoom,
  STORAGE_CANVAS_CLUSTER_MAX_ZOOM,
} from './storageTankFarmsLayer';
import { resolveEffectiveLayers } from './layerVisibilityAuthority';
import { applyAssetLayerPreset } from './assetLayerCockpit';

describe('map interaction contract', () => {
  it('cluster parse uses flyToBounds max zoom not list popup', () => {
    expect(storageClusterParseMaxZoom()).toBe(STORAGE_CANVAS_CLUSTER_MAX_ZOOM + 1);
  });

  it('all layers off does not enable license or storage fetches', () => {
    const clean = applyAssetLayerPreset('clean');
    const gates = resolveEffectiveLayers({
      assetVisibility: clean,
      viewMode: 'oil_and_gas',
      assetCockpitActive: true,
    });
    expect(gates.shouldFetchLicenses).toBe(false);
    expect(gates.shouldFetchStorageTerminals).toBe(false);
    expect(gates.petroleumPrefs.showGemPipelines).toBe(false);
  });
});
