import { describe, expect, it } from 'vitest';
import {
  MARITIME_HUB_PRESETS,
  AIR_HUB_PRESETS,
  buildAllLocationPresets,
  buildRoutePlannerAirportMarkers,
  buildRoutePlannerPortMarkers,
  filterLicensesForRouteHubs,
  countriesMatchRouteHubFilter,
  resolveRolePresetCountries,
  resolveRouteHubCountries,
  buyerCountryRequiredForHubs,
  findNearestHubInCountry,
} from './locationPresets';
import type { MiningLicense } from '../../types';

describe('resolveRouteHubCountries', () => {
  it('requires destination country', () => {
    expect(resolveRouteHubCountries('Zambia', undefined)).toEqual([]);
    expect(buyerCountryRequiredForHubs(undefined)).toBe(true);
  });

  it('includes origin and destination when both set', () => {
    const countries = resolveRouteHubCountries('Zambia', 'Netherlands');
    expect(countries).toContain('Zambia');
    expect(countries).toContain('Netherlands');
    expect(countries).toHaveLength(2);
  });
});

describe('findNearestHubInCountry', () => {
  it('returns Israeli hub when snapping from foreign coordinates', () => {
    const hub = findNearestHubInCountry(-29.868, 31.05, 'Israel');
    expect(hub).not.toBeNull();
    expect(hub?.country).toBe('Israel');
    expect(hub?.name).toMatch(/Haifa|Ashdod|Eilat|Ben Gurion/);
  });
});

describe('countriesMatchRouteHubFilter', () => {
  it('matches canonical country names', () => {
    expect(countriesMatchRouteHubFilter('Netherlands', ['Netherlands'])).toBe(true);
    expect(countriesMatchRouteHubFilter('United States', ['United States of America'])).toBe(true);
    expect(countriesMatchRouteHubFilter('Israel', ['Netherlands'])).toBe(false);
  });
});

describe('buildRoutePlannerPortMarkers', () => {
  it('returns only hubs in filter countries', () => {
    const all = buildRoutePlannerPortMarkers([], [], { countries: ['Israel'] });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((m) => m.country === 'Israel')).toBe(true);
    expect(all.some((m) => m.name.includes('Haifa'))).toBe(true);
  });

  it('does not return world catalog when countries empty', () => {
    const filtered = buildRoutePlannerPortMarkers([], [], { countries: [] });
    expect(filtered).toHaveLength(0);
    const unfiltered = buildRoutePlannerPortMarkers([], []);
    expect(unfiltered.length).toBeGreaterThan(MARITIME_HUB_PRESETS.length);
  });
});

describe('buildRoutePlannerAirportMarkers', () => {
  it('includes TLV for Israel', () => {
    const airports = buildRoutePlannerAirportMarkers({ countries: ['Israel'] });
    expect(airports.some((a) => a.name.includes('Ben Gurion'))).toBe(true);
    expect(airports.length).toBeLessThanOrEqual(AIR_HUB_PRESETS.length);
  });
});

describe('resolveRolePresetCountries', () => {
  it('filters supplier dropdown by origin country only', () => {
    expect(resolveRolePresetCountries('supplier', 'Zambia', 'Israel')).toEqual(['Zambia']);
    expect(resolveRolePresetCountries('buyer', 'Zambia', 'Israel')).toEqual(
      expect.arrayContaining(['Zambia', 'Israel']),
    );
  });
});

describe('filterLicensesForRouteHubs', () => {
  it('returns only licenses in filter countries', () => {
    const licenses = [
      { id: 'a', country: 'Israel', lat: 1, lng: 2 } as MiningLicense,
      { id: 'b', country: 'Canada', lat: 3, lng: 4 } as MiningLicense,
    ];
    const filtered = filterLicensesForRouteHubs(licenses, ['Israel']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a');
  });
});

describe('buildAllLocationPresets', () => {
  const mixedLicenses: MiningLicense[] = [
    {
      id: 'bc-1',
      company: 'BC Mine',
      country: 'Canada',
      lat: 49.2,
      lng: -123.1,
    } as MiningLicense,
    {
      id: 'il-1',
      company: 'Negev Site',
      country: 'Israel',
      lat: 30.6,
      lng: 34.8,
    } as MiningLicense,
  ];

  it('returns empty list when country filter is set but empty (avoids full-pool scan)', () => {
    const presets = buildAllLocationPresets(mixedLicenses, [], { countries: [] });
    expect(presets).toEqual([]);
  });

  it('excludes non-matching concessions when destination country is set', () => {
    const presets = buildAllLocationPresets(mixedLicenses, [], {
      countries: ['Israel'],
    });
    const licenseNames = presets.filter((p) => p.group === 'licenses').map((p) => p.name);
    expect(licenseNames.some((n) => n.includes('Negev'))).toBe(true);
    expect(licenseNames.some((n) => n.includes('BC Mine'))).toBe(false);
    expect(presets.some((p) => p.name.includes('Haifa'))).toBe(true);
    expect(presets.some((p) => p.name.includes('Rotterdam'))).toBe(false);
  });
});
