import { describe, expect, it } from 'vitest';
import {
  findNearestStorageTerminal,
  formatStorageLocatorContext,
  formatStorageOperatorLabel,
  formatStorageOwnerLabel,
  formatStorageSiteContextNearLine,
  formatStorageSourceLabel,
  formatStorageSubstanceLabel,
  isGenericStorageTerminalTitle,
  shouldShowStorageSiteContextNear,
  storageTankFarmClusterGridMultiplier,
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

describe('storageTankFarmClusterGridMultiplier', () => {
  it('coarsens tank-farm clusters at world zoom and relaxes at detail zoom', () => {
    expect(storageTankFarmClusterGridMultiplier(4)).toBeGreaterThan(
      storageTankFarmClusterGridMultiplier(6),
    );
    expect(storageTankFarmClusterGridMultiplier(6)).toBeGreaterThan(
      storageTankFarmClusterGridMultiplier(8),
    );
    expect(storageTankFarmClusterGridMultiplier(10)).toBe(1);
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

describe('findNearestStorageTerminal', () => {
  it('returns the closest entity within fusion distance', () => {
    const entities = [
      { id: 'a', lat: 25.0, lng: 55.0, company: 'Near' } as const,
      { id: 'b', lat: 25.5, lng: 55.5, company: 'Far' } as const,
    ];
    const nearest = findNearestStorageTerminal(entities as never, 25.01, 55.01, 5000);
    expect(nearest?.id).toBe('a');
  });

  it('returns null when nothing is within max distance', () => {
    const entities = [{ id: 'a', lat: 25.0, lng: 55.0, company: 'Hub' } as const];
    expect(findNearestStorageTerminal(entities as never, 30, 60, 1000)).toBeNull();
  });
});
