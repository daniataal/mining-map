import { describe, expect, it } from 'vitest';
import {
  MARITIME_HUB_PRESETS,
  AIR_HUB_PRESETS,
  MAX_DROPDOWN_PRESETS_PER_GROUP,
  MAX_PRESET_SEARCH_RESULTS,
  MAX_ROUTE_MODE_TOTAL_HUB_MARKERS,
  buildAllLocationPresets,
  buildRouteHubPresets,
  MAX_ROUTE_PRESET_ITEMS,
  buildRoutePlannerAirportMarkers,
  buildRoutePlannerPortMarkers,
  filterLicensesForRouteHubs,
  countriesMatchRouteHubFilter,
  resolveRolePresetCountries,
  resolveRouteHubCountries,
  buyerCountryRequiredForHubs,
  findNearestHubInCountry,
  searchLocationPresets,
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

  it('treats ISO2 country codes as exact codes before fuzzy names', () => {
    expect(countriesMatchRouteHubFilter('IL', ['Israel'])).toBe(true);
    expect(countriesMatchRouteHubFilter('IS', ['Israel'])).toBe(false);
    expect(countriesMatchRouteHubFilter('IS', ['Iceland'])).toBe(true);
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

  it('excludes Icelandic ISO2 ports from Israel marker filters', () => {
    const portEntities = [
      { id: 'is-port', company: 'Arskogssandur Port', country: 'IS', entityKind: 'port', entitySubtype: 'port', lat: 65.9, lng: -18.2 } as MiningLicense,
      { id: 'il-port', company: 'Haifa Custom Port', country: 'IL', entityKind: 'port', entitySubtype: 'port', lat: 32.81, lng: 34.98 } as MiningLicense,
    ];
    const filtered = buildRoutePlannerPortMarkers([], portEntities, { countries: ['Israel'] });
    expect(filtered.some((m) => m.name.includes('Arskogssandur'))).toBe(false);
    expect(filtered.some((m) => m.name.includes('Haifa Custom'))).toBe(true);
  });

  it('excludes rail and logistics nodes from route port markers', () => {
    const portEntities = [
      {
        id: 'il-port',
        company: 'Haifa Custom Port',
        country: 'Israel',
        entityKind: 'port',
        entitySubtype: 'port',
        lat: 32.81,
        lng: 34.98,
      } as MiningLicense,
      {
        id: 'il-rail',
        company: 'Israel Rail Terminal',
        country: 'Israel',
        entityKind: 'logistics_node',
        entitySubtype: 'rail_terminal',
        sector: 'ports',
        lat: 31.8,
        lng: 34.7,
      } as MiningLicense,
      {
        id: 'il-logistics',
        company: 'Israel Logistics Hub',
        country: 'Israel',
        entityKind: 'logistics_node',
        entitySubtype: 'logistics_hub',
        sector: 'ports',
        lat: 31.7,
        lng: 34.6,
      } as MiningLicense,
    ];
    const filtered = buildRoutePlannerPortMarkers([], portEntities, { countries: ['Israel'] });
    expect(filtered.some((m) => m.name.includes('Haifa Custom'))).toBe(true);
    expect(filtered.some((m) => m.name.includes('Rail Terminal'))).toBe(false);
    expect(filtered.some((m) => m.name.includes('Logistics Hub'))).toBe(false);
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
  it('filters supplier dropdown by origin country and buyer dropdown by destination country', () => {
    expect(resolveRolePresetCountries('supplier', 'Zambia', 'Israel')).toEqual(['Zambia']);
    expect(resolveRolePresetCountries('buyer', 'Zambia', 'Israel')).toEqual(['Israel']);
  });
});

describe('filterLicensesForRouteHubs', () => {
  it('returns only licenses in filter countries', () => {
    const licenses = [
      { id: 'a', country: 'Israel', lat: 1, lng: 2 } as MiningLicense,
      { id: 'b', country: 'Canada', lat: 3, lng: 4 } as MiningLicense,
      { id: 'c', country: 'Global', lat: 5, lng: 6, recordOrigin: 'global_open_fallback' } as MiningLicense,
    ];
    const filtered = filterLicensesForRouteHubs(licenses, ['Israel']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('a');
  });
});

describe('searchLocationPresets', () => {
  const manyPresets = Array.from({ length: 50 }, (_, i) => ({
    id: `p-${i}`,
    name: `Port ${i} Israel`,
    lat: 32 + i * 0.01,
    lng: 34.8,
    country: 'Israel',
    group: 'ports' as const,
  }));

  it('caps search results at MAX_PRESET_SEARCH_RESULTS', () => {
    const hits = searchLocationPresets(manyPresets, 'port');
    expect(hits.length).toBeLessThanOrEqual(MAX_PRESET_SEARCH_RESULTS);
    expect(hits.length).toBe(MAX_PRESET_SEARCH_RESULTS);
  });
});

describe('buildRouteHubPresets', () => {
  it('returns Ghana and Israel hubs without scanning licenses', () => {
    const start = performance.now();
    const ghana = buildRouteHubPresets([], { countries: ['Ghana'] });
    const israel = buildRouteHubPresets([], { countries: ['Israel'] });
    const elapsed = performance.now() - start;

    expect(ghana.some((p) => p.name.includes('Tema'))).toBe(true);
    expect(israel.some((p) => p.name.includes('Haifa'))).toBe(true);
    expect(ghana.length).toBeLessThanOrEqual(MAX_ROUTE_PRESET_ITEMS);
    expect(elapsed).toBeLessThan(50);
  });

  it('returns empty when no countries selected', () => {
    expect(buildRouteHubPresets([], { countries: [] })).toEqual([]);
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

  it('shows only maritime ports and airports for a destination country hub list', () => {
    const portEntities = [
      {
        id: 'il-port',
        company: 'Haifa Custom Port',
        country: 'IL',
        countryIso2: 'IL',
        entityKind: 'port',
        entitySubtype: 'port',
        sector: 'ports',
        lat: 32.81,
        lng: 34.98,
      } as MiningLicense,
      {
        id: 'il-rail',
        company: 'Israel Rail Terminal',
        country: 'IL',
        countryIso2: 'IL',
        entityKind: 'logistics_node',
        entitySubtype: 'rail_terminal',
        sector: 'ports',
        lat: 31.8,
        lng: 34.7,
      } as MiningLicense,
      {
        id: 'is-port',
        company: 'Iceland Custom Port',
        country: 'IS',
        countryIso2: 'IS',
        entityKind: 'port',
        entitySubtype: 'port',
        sector: 'ports',
        lat: 65.9,
        lng: -18.2,
      } as MiningLicense,
      {
        id: 'global-port',
        company: 'Global Fallback Port',
        country: 'Global',
        countryIso2: 'IL',
        entityKind: 'port',
        entitySubtype: 'port',
        sector: 'ports',
        recordOrigin: 'global_open_fallback',
        lat: 32.9,
        lng: 35.1,
      } as MiningLicense,
    ];
    const presets = buildAllLocationPresets([], portEntities, { countries: ['Israel'] });
    const names = presets.map((p) => p.name);
    expect(names.some((name) => name.includes('Haifa Custom'))).toBe(true);
    expect(names.some((name) => name.includes('Ben Gurion'))).toBe(true);
    expect(names.some((name) => name.includes('Rail Terminal'))).toBe(false);
    expect(names.some((name) => name.includes('Iceland'))).toBe(false);
    expect(names.some((name) => name.includes('Global Fallback'))).toBe(false);
  });

  it('caps each group at MAX_DROPDOWN_PRESETS_PER_GROUP', () => {
    const licenses = Array.from({ length: 60 }, (_, i) => ({
      id: `il-${i}`,
      company: `Site ${i}`,
      country: 'Israel',
      lat: 30.6 + i * 0.001,
      lng: 34.8,
    })) as MiningLicense[];
    const presets = buildAllLocationPresets(licenses, [], { countries: ['Israel'] });
    const licenseCount = presets.filter((p) => p.group === 'licenses').length;
    expect(licenseCount).toBeLessThanOrEqual(MAX_DROPDOWN_PRESETS_PER_GROUP);
  });
});

describe('route mode hub marker caps', () => {
  it('limits combined port markers in route mode', () => {
    const ports = buildRoutePlannerPortMarkers([], [], {
      countries: ['Israel', 'Netherlands'],
      maxTotal: MAX_ROUTE_MODE_TOTAL_HUB_MARKERS,
    });
    expect(ports.length).toBeLessThanOrEqual(MAX_ROUTE_MODE_TOTAL_HUB_MARKERS);
  });
});
