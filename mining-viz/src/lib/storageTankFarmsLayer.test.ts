import { describe, expect, it } from 'vitest';
import {
  formatStorageLocatorContext,
  formatStorageOperatorLabel,
  formatStorageOwnerLabel,
  formatStorageSiteContextNearLine,
  formatStorageSourceLabel,
  formatStorageSubstanceLabel,
  isGenericStorageTerminalTitle,
  shouldShowStorageSiteContextNear,
  storageTankFarmsLayerShouldMount,
  storageTerminalOsmTagSummary,
  STORAGE_OPERATOR_UNTAGGED,
} from './storageTankFarmsLayer';

describe('storageTankFarmsLayerShouldMount', () => {
  it('mounts overlay when enabled even with zero entities (LayersControl registration)', () => {
    expect(storageTankFarmsLayerShouldMount(true)).toBe(true);
    expect(storageTankFarmsLayerShouldMount(true, 5)).toBe(true);
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

  it('detects generic storage titles and formats nearby site context', () => {
    expect(isGenericStorageTerminalTitle('Unnamed Storage Terminal')).toBe(true);
    expect(isGenericStorageTerminalTitle('Unnamed storage tank')).toBe(true);
    expect(isGenericStorageTerminalTitle('Abu Dhabi National Oil Company')).toBe(false);

    expect(formatStorageSiteContextNearLine('Abu Dhabi National Oil Company')).toBe(
      'Near Abu Dhabi National Oil Company',
    );
    expect(
      shouldShowStorageSiteContextNear({
        company: 'Unnamed storage tank',
        siteContextName: 'Abu Dhabi National Oil Company',
      }),
    ).toBe(true);
    expect(
      shouldShowStorageSiteContextNear({
        company: 'Abu Dhabi National Oil Company',
        siteContextName: 'Abu Dhabi National Oil Company',
      }),
    ).toBe(false);
  });

  it('builds locator context from site name and locality', () => {
    expect(
      formatStorageLocatorContext({
        siteContextName: 'Abu Dhabi National Oil Company',
        region: 'Sas Al Nakhl',
        country: 'United Arab Emirates',
        locode: null,
        nearbyPort: null,
        operatorName: null,
        subdivision: null,
      }),
    ).toBe('Abu Dhabi National Oil Company · Sas Al Nakhl, United Arab Emirates');

    expect(
      formatStorageLocatorContext({
        siteContextName: null,
        region: 'Rotterdam',
        country: 'Netherlands',
        locode: 'NLRTM',
        nearbyPort: { name: 'Port of Rotterdam' } as never,
        operatorName: 'Vopak',
        subdivision: null,
      }),
    ).toBe('NLRTM · Rotterdam, Netherlands · Port of Rotterdam');
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
