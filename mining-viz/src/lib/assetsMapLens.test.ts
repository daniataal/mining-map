import { describe, expect, it } from 'vitest';
import {
  assetsMapLens,
  assetsMapLensHelperCopy,
  assetsPetroleumLayerPrefs,
} from './assetsMapLens';

describe('assetsMapLens', () => {
  it('returns sublayer only for assets mode', () => {
    expect(assetsMapLens('assets', 'refineries')).toBe('refineries');
    expect(assetsMapLens('global_view', 'refineries')).toBeNull();
    expect(assetsMapLens('assets', 'mines')).toBe('mines');
  });
});

describe('assetsPetroleumLayerPrefs', () => {
  it('keeps legacy defaults when lens is null', () => {
    const prefs = assetsPetroleumLayerPrefs(null);
    expect(prefs.showGemPipelines).toBe(true);
    expect(prefs.showStorageTankFarms).toBe(true);
    expect(prefs.osmLayerIds).toEqual(['pipelines', 'refineries']);
  });

  it('emphasizes pipelines for oil_fields', () => {
    const prefs = assetsPetroleumLayerPrefs('oil_fields');
    expect(prefs.osmLayerIds).toEqual(['pipelines']);
    expect(prefs.osmLayerVisibility?.refineries).toBe(false);
    expect(prefs.showGemPipelines).toBe(true);
    expect(prefs.showStorageTankFarms).toBe(false);
  });

  it('emphasizes refineries OSM layer for refineries lens', () => {
    const prefs = assetsPetroleumLayerPrefs('refineries');
    expect(prefs.osmLayerIds).toEqual(['refineries']);
    expect(prefs.osmLayerVisibility?.refineries).toBe(true);
    expect(prefs.osmLayerVisibility?.pipelines).toBe(false);
    expect(prefs.showGemPipelines).toBe(false);
    expect(prefs.showGemPlants).toBe(true);
  });

  it('emphasizes storage for tank_farms lens', () => {
    const prefs = assetsPetroleumLayerPrefs('tank_farms');
    expect(prefs.osmLayerIds).toEqual(['storage_terminals']);
    expect(prefs.showStorageTankFarms).toBe(true);
    expect(prefs.showGemPipelines).toBe(false);
  });
});

describe('assetsMapLensHelperCopy', () => {
  it('provides helper copy for petroleum sublayers', () => {
    expect(assetsMapLensHelperCopy('refineries').en).toContain('Refineries');
    expect(assetsMapLensHelperCopy('tank_farms').en).toContain('Storage');
  });
});
