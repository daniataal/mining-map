import { describe, expect, it } from 'vitest';
import {
  formatStorageOperatorLabel,
  formatStorageOwnerLabel,
  formatStorageSourceLabel,
  formatStorageSubstanceLabel,
  storageTankFarmsLayerShouldMount,
  storageTerminalOsmTagSummary,
  STORAGE_OPERATOR_UNTAGGED,
} from './storageTankFarmsLayer';

describe('storageTankFarmsLayerShouldMount', () => {
  it('mounts overlay when enabled even with zero entities (LayersControl registration)', () => {
    expect(storageTankFarmsLayerShouldMount(true)).toBe(true);
    expect(storageTankFarmsLayerShouldMount(false)).toBe(false);
  });
});

describe('storage terminal popup helpers', () => {
  it('shows untagged operator label when operator is missing', () => {
    expect(formatStorageOperatorLabel(null)).toBe(STORAGE_OPERATOR_UNTAGGED);
    expect(formatStorageOperatorLabel('  ')).toBe(STORAGE_OPERATOR_UNTAGGED);
    expect(formatStorageOperatorLabel('Vopak')).toBe('Vopak');
  });

  it('formats owner and substance from entity fields', () => {
    expect(formatStorageOwnerLabel('Shell')).toBe('Shell');
    expect(formatStorageOwnerLabel('')).toBeNull();
    expect(
      formatStorageSubstanceLabel({ substanceText: 'diesel', commodity: 'petroleum' }),
    ).toBe('diesel');
    expect(formatStorageSubstanceLabel({ commodity: 'petroleum' })).toBe('petroleum');
  });

  it('summarizes priority OSM tags for dossier display', () => {
    expect(
      storageTerminalOsmTagSummary({
        tags: {
          man_made: 'storage_tank',
          operator: 'ADNOC',
          substance: 'crude oil',
          ignored: 'x',
        },
      }),
    ).toEqual([
      { key: 'man_made', value: 'storage_tank' },
      { key: 'operator', value: 'ADNOC' },
      { key: 'substance', value: 'crude oil' },
    ]);
  });

  it('labels curated reference vs OSM source names', () => {
    expect(
      formatStorageSourceLabel({
        sourceKind: 'curated_reference',
        sourceName: 'Curated major global petroleum storage terminals',
      }),
    ).toBe('Curated reference');
    expect(
      formatStorageSourceLabel({
        sourceKind: null,
        sourceName: 'OpenStreetMap via Overpass',
      }),
    ).toBe('OpenStreetMap via Overpass');
    expect(formatStorageSourceLabel({})).toBe('OpenStreetMap');
  });
});
