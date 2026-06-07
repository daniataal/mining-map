import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_LAYER_VISIBILITY,
  applyAssetLayerPreset,
  assetLicenseMarkersEnabled,
  assetsPetroleumLayerPrefsFromVisibility,
  resolveAssetLicenseSector,
  resolveAssetMapViewKey,
  toggleAssetLayer,
} from './assetLayerCockpit';

describe('assetLayerCockpit', () => {
  it('opens assets as an overview instead of a mining-only page', () => {
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.mines).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.oil_fields).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.refineries).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.tank_farms).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.ports).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.pipelines).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.lng).toBe(true);
    expect(DEFAULT_ASSET_LAYER_VISIBILITY.ais_vessels).toBe(false);
    expect(resolveAssetMapViewKey(DEFAULT_ASSET_LAYER_VISIBILITY)).toBe('oil_and_gas');
    expect(resolveAssetLicenseSector(DEFAULT_ASSET_LAYER_VISIBILITY)).toBeUndefined();
  });

  it('keeps the overview preset aligned with the default cockpit state', () => {
    expect(applyAssetLayerPreset('overview')).toEqual(DEFAULT_ASSET_LAYER_VISIBILITY);
  });

  it('treats asset types as combinable toggles', () => {
    const oilLogistics = applyAssetLayerPreset('oil_logistics');

    expect(oilLogistics.oil_fields).toBe(true);
    expect(oilLogistics.refineries).toBe(true);
    expect(oilLogistics.tank_farms).toBe(true);
    expect(oilLogistics.ports).toBe(false);
    expect(oilLogistics.pipelines).toBe(true);
    expect(oilLogistics.lng).toBe(false);
    expect(resolveAssetMapViewKey(oilLogistics)).toBe('oil_and_gas');
    expect(resolveAssetLicenseSector(oilLogistics)).toBe('oil_and_gas');
  });

  it('supports clean map without fetching license markers', () => {
    const clean = applyAssetLayerPreset('clean');

    expect(assetLicenseMarkersEnabled(clean)).toBe(false);
    expect(resolveAssetLicenseSector(clean)).toBeUndefined();
    expect(resolveAssetMapViewKey(clean)).toBe('mining');
  });

  it('renders petroleum overlays from independent layer visibility', () => {
    const visibility = toggleAssetLayer(applyAssetLayerPreset('clean'), 'tank_farms');
    const prefs = assetsPetroleumLayerPrefsFromVisibility(visibility);

    expect(prefs.showOsmPetroleum).toBe(true);
    expect(prefs.osmLayerIds).toEqual(['storage_terminals']);
    expect(prefs.showStorageTankFarms).toBe(true);
    expect(prefs.showGemPipelines).toBe(false);
  });
});
