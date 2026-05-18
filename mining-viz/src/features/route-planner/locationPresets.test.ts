import { describe, expect, it } from 'vitest';
import {
  MARITIME_HUB_PRESETS,
  AIR_HUB_PRESETS,
  buildRoutePlannerAirportMarkers,
  buildRoutePlannerPortMarkers,
  countriesMatchRouteHubFilter,
  resolveRouteHubCountries,
  buyerCountryRequiredForHubs,
} from './locationPresets';

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
