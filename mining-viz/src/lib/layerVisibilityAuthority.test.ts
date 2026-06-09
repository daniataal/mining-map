import { describe, expect, it } from 'vitest';
import { applyAssetLayerPreset } from './assetLayerCockpit';
import { resolveEffectiveLayers } from './layerVisibilityAuthority';

describe('resolveEffectiveLayers', () => {
  it('keeps oil_and_gas view when all petroleum toggles are off (no mining flip)', () => {
    const clean = applyAssetLayerPreset('clean');
    const gates = resolveEffectiveLayers({
      assetVisibility: clean,
      viewMode: 'global',
      assetCockpitActive: true,
    });
    expect(gates.viewModeKey).toBe('oil_and_gas');
    expect(gates.shouldFetchLicenses).toBe(false);
    expect(gates.shouldFetchStorageTerminals).toBe(false);
    expect(gates.shouldFetchBunkerSuppliers).toBe(false);
    expect(gates.shouldMountInfrastructure).toBe(false);
  });

  it('fetches bunker suppliers when registry is open even if toggle off', () => {
    const clean = applyAssetLayerPreset('clean');
    const gates = resolveEffectiveLayers({
      assetVisibility: clean,
      viewMode: 'global',
      assetCockpitActive: true,
      bunkerRegistryOpen: true,
    });
    expect(gates.shouldFetchBunkerSuppliers).toBe(true);
  });

  it('gates storage fetch to tank_farms toggle', () => {
    const oil = applyAssetLayerPreset('oil_logistics');
    const gates = resolveEffectiveLayers({
      assetVisibility: oil,
      viewMode: 'oil_and_gas',
      assetCockpitActive: true,
    });
    expect(gates.shouldFetchStorageTerminals).toBe(true);
    expect(gates.petroleumPrefs.showStorageTankFarms).toBe(true);
    expect(gates.shouldMountInfrastructure).toBe(true);
  });

  it('mounts infrastructure in route planner pipelines mode when petroleum off', () => {
    const clean = applyAssetLayerPreset('clean');
    const gates = resolveEffectiveLayers({
      assetVisibility: clean,
      viewMode: 'route_planner',
      assetCockpitActive: true,
      routePlannerPipelinesMode: true,
    });
    expect(gates.shouldMountInfrastructure).toBe(true);
  });
});
