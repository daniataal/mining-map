import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSET_LAYER_VISIBILITY,
  applyAssetLayerPreset,
  assetLayerIdsForPreset,
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
    expect(oilLogistics.plants).toBe(true);
    expect(oilLogistics.tank_farms).toBe(true);
    expect(oilLogistics.mines).toBe(false);
    expect(oilLogistics.ports).toBe(false);
    expect(oilLogistics.pipelines).toBe(true);
    expect(oilLogistics.lng).toBe(false);
    expect(resolveAssetMapViewKey(oilLogistics)).toBe('oil_and_gas');
    expect(resolveAssetLicenseSector(oilLogistics)).toBe('oil_and_gas');
  });

  it('scopes layer chrome by preset', () => {
    expect(assetLayerIdsForPreset('mining')).toEqual(['mines', 'country_borders', 'esg_zones']);
    expect(assetLayerIdsForPreset('oil_logistics')).toContain('plants');
    expect(assetLayerIdsForPreset('oil_logistics')).not.toContain('mines');
  });

  it('drives GEM plants from plants toggle not refineries', () => {
    const refineriesOnly = {
      ...applyAssetLayerPreset('oil_logistics'),
      plants: false,
      refineries: true,
    };
    const plantsOnly = {
      ...applyAssetLayerPreset('oil_logistics'),
      plants: true,
      refineries: false,
    };
    expect(assetsPetroleumLayerPrefsFromVisibility(refineriesOnly).showGemPlants).toBe(false);
    expect(assetsPetroleumLayerPrefsFromVisibility(plantsOnly).showGemPlants).toBe(true);
  });

  it('supports clean map without fetching license markers', () => {
    const clean = applyAssetLayerPreset('clean');

    expect(assetLicenseMarkersEnabled(clean)).toBe(false);
    expect(resolveAssetLicenseSector(clean)).toBeUndefined();
  });

  it('resolves oil-only asset visibility to oil_and_gas sector', () => {
    const oilOnly = { ...DEFAULT_ASSET_LAYER_VISIBILITY, mines: false, oil_fields: true };
    expect(resolveAssetLicenseSector(oilOnly)).toBe('oil_and_gas');
    expect(resolveAssetMapViewKey(oilOnly)).toBe('oil_and_gas');
  });

  it('renders petroleum overlays from independent layer visibility', () => {
    const visibility = toggleAssetLayer(applyAssetLayerPreset('clean'), 'tank_farms');
    const prefs = assetsPetroleumLayerPrefsFromVisibility(visibility);

    expect(prefs.showOsmPetroleum).toBe(true);
    expect(prefs.osmLayerIds).toEqual(['storage_terminals']);
    expect(prefs.showStorageTankFarms).toBe(true);
    expect(prefs.showGemPipelines).toBe(false);
    expect(prefs.showBunkerSuppliers).toBe(false);
  });

  it('drives bunker supplier markers from bunker_suppliers toggle', () => {
    const oilLogistics = applyAssetLayerPreset('oil_logistics');
    expect(assetsPetroleumLayerPrefsFromVisibility(oilLogistics).showBunkerSuppliers).toBe(true);

    const hidden = toggleAssetLayer(oilLogistics, 'bunker_suppliers');
    expect(assetsPetroleumLayerPrefsFromVisibility(hidden).showBunkerSuppliers).toBe(false);
    expect(assetLayerIdsForPreset('oil_logistics')).toContain('bunker_suppliers');
  });
});
