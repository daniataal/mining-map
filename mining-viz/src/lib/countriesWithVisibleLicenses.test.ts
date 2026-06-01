import { describe, expect, it } from 'vitest';
import {
  countriesForMapBorders,
  countriesWithVisibleLicenses,
  countryLicenseCounts,
  countryLicenseCountsForBorders,
  licenseHasMapCoordinates,
} from './countriesWithVisibleLicenses';
import type { MiningLicense } from '../types';

function license(partial: Partial<MiningLicense> & Pick<MiningLicense, 'id'>): MiningLicense {
  return {
    company: 'Test Co',
    ...partial,
  } as MiningLicense;
}

describe('licenseHasMapCoordinates', () => {
  it('requires finite lat/lng', () => {
    expect(licenseHasMapCoordinates(license({ id: 'a', lat: 1, lng: 2 }))).toBe(true);
    expect(licenseHasMapCoordinates(license({ id: 'b', lat: null, lng: 2 }))).toBe(false);
    expect(licenseHasMapCoordinates(license({ id: 'c', lat: Number.NaN, lng: 2 }))).toBe(false);
  });
});

describe('countriesWithVisibleLicenses', () => {
  it('returns only countries with at least one mappable license', () => {
    const rows = [
      license({ id: '1', country: 'Ghana', lat: 5, lng: -1 }),
      license({ id: '2', country: 'Ghana', lat: 5.1, lng: -1.1 }),
      license({ id: '3', country: 'Mali', lat: null, lng: 1 }),
      license({ id: '4', country: 'Peru', lat: -12, lng: -77 }),
    ];
    expect(countriesWithVisibleLicenses(rows)).toEqual(['Ghana', 'Peru']);
  });

  it('dedupes country names case-insensitively', () => {
    const rows = [
      license({ id: '1', country: 'ghana', lat: 1, lng: 1 }),
      license({ id: '2', country: 'Ghana', lat: 2, lng: 2 }),
    ];
    expect(countriesWithVisibleLicenses(rows)).toEqual(['ghana']);
  });

  it('reflects search filter — excludes countries with zero matches', () => {
    const all = [
      license({ id: '1', country: 'Ghana', commodity: 'Gold', lat: 5, lng: -1 }),
      license({ id: '2', country: 'Peru', commodity: 'Copper', lat: -12, lng: -77 }),
    ];
    const goldOnly = all.filter((r) => r.commodity?.toLowerCase().includes('gold'));
    expect(countriesWithVisibleLicenses(goldOnly)).toEqual(['Ghana']);
    expect(countriesWithVisibleLicenses(all)).toEqual(['Ghana', 'Peru']);
  });
});

describe('countryLicenseCounts', () => {
  it('counts only mappable licenses per country', () => {
    const rows = [
      license({ id: '1', country: 'Ghana', lat: 1, lng: 1 }),
      license({ id: '2', country: 'Ghana', lat: 2, lng: 2 }),
      license({ id: '3', country: 'Ghana', lat: null, lng: 1 }),
      license({ id: '4', country: 'Peru', lat: 3, lng: 3 }),
    ];
    expect(countryLicenseCounts(rows)).toEqual([
      { country: 'Ghana', count: 2 },
      { country: 'Peru', count: 1 },
    ]);
  });
});

describe('countryLicenseCountsForBorders', () => {
  it('weights server clusters by mapClusterCount', () => {
    const rows = [
      license({ id: '1', country: 'Australia', lat: -25, lng: 133, mapClusterCount: 4925 }),
      license({ id: '2', country: 'Russia', lat: 55, lng: 37, mapClusterCount: 22 }),
      license({ id: '3', country: 'Russia', lat: 56, lng: 38, mapClusterCount: 15 }),
    ];
    expect(countryLicenseCountsForBorders(rows)).toEqual([
      { country: 'Australia', count: 4925 },
      { country: 'Russia', count: 37 },
    ]);
  });
});

describe('countriesForMapBorders', () => {
  it('returns every country present on the map when under cap', () => {
    const rows = [
      license({ id: '1', country: 'Ghana', lat: 5, lng: -1, mapClusterCount: 10 }),
      license({ id: '2', country: 'Peru', lat: -12, lng: -77, mapClusterCount: 3 }),
    ];
    expect(countriesForMapBorders(rows, 50)).toEqual(['Ghana', 'Peru']);
  });
});
