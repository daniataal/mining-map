import { describe, expect, it } from 'vitest';
import {
  OSM_PETROLEUM_LAYER_IDS,
  defaultOsmLayerVisibility,
} from './osmPetroleumLayers';

describe('osmPetroleumLayers', () => {
  it('includes storage_terminals in layer ids for API hooks', () => {
    expect(OSM_PETROLEUM_LAYER_IDS).toContain('storage_terminals');
  });

  it('defaults storage layer off in map panel (dedicated StorageTankFarmsMapLayer is on)', () => {
    expect(defaultOsmLayerVisibility(true).storage_terminals).toBe(false);
    expect(defaultOsmLayerVisibility(false).storage_terminals).toBe(false);
  });
});
