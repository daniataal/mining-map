import { describe, expect, it } from 'vitest';
import {
  licenseMatchesCountryFocus,
  licenseMatchesSelectedCountries,
  pointInLicenseViewportBounds,
} from './licenseCountryMatch';
import type { MiningLicense } from '../types';

const base: MiningLicense = {
  id: '1',
  company: 'Test',
  licenseType: 'Exploration',
  commodity: 'Gold',
  status: 'Active',
  date: '2020',
  country: 'Pakistan',
  region: '',
  lat: 34.0,
  lng: 73.0,
};

describe('licenseMatchesSelectedCountries', () => {
  it('matches case-insensitively', () => {
    expect(licenseMatchesSelectedCountries({ ...base, country: 'pakistan' }, ['Pakistan'])).toBe(true);
    expect(licenseMatchesSelectedCountries(base, ['Peru'])).toBe(false);
  });

  it('returns true when no countries selected', () => {
    expect(licenseMatchesSelectedCountries(base, [])).toBe(true);
  });
});

describe('licenseMatchesCountryFocus', () => {
  const bounds = { south: 23, west: 60, north: 37, east: 78 };

  it('matches by country label', () => {
    expect(licenseMatchesCountryFocus(base, 'Pakistan', bounds)).toBe(true);
  });

  it('matches by coords inside bounds when country label differs', () => {
    expect(
      licenseMatchesCountryFocus({ ...base, country: 'India' }, 'Pakistan', bounds),
    ).toBe(true);
  });

  it('rejects points outside bounds with wrong label', () => {
    expect(
      licenseMatchesCountryFocus(
        { ...base, country: 'Peru', lat: -10, lng: -70 },
        'Pakistan',
        bounds,
      ),
    ).toBe(false);
  });
});

describe('pointInLicenseViewportBounds', () => {
  it('checks inclusive edges', () => {
    const b = { south: 0, west: 0, north: 10, east: 10 };
    expect(pointInLicenseViewportBounds(5, 5, b)).toBe(true);
    expect(pointInLicenseViewportBounds(11, 5, b)).toBe(false);
  });
});
