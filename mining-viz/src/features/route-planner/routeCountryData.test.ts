import { describe, expect, it } from 'vitest';
import { filterRouteCountries, ROUTE_COUNTRY_SEARCH_MAX, TOP_ROUTE_COUNTRIES } from './routeCountryData';

describe('filterRouteCountries', () => {
  it('returns top countries first when search is empty', () => {
    const results = filterRouteCountries('');
    expect(results[0]).toBe(TOP_ROUTE_COUNTRIES[0]);
    expect(results.length).toBeLessThanOrEqual(ROUTE_COUNTRY_SEARCH_MAX);
  });

  it('filters by query and caps results', () => {
    const results = filterRouteCountries('isra');
    expect(results).toContain('Israel');
    expect(results.length).toBeLessThanOrEqual(ROUTE_COUNTRY_SEARCH_MAX);
    expect(results.some((c) => c === 'Chile')).toBe(false);
  });
});
