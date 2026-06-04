import { describe, expect, it } from 'vitest';
import {
  applyCountrySummaryRequestParams,
  countrySummaryRowsToLicenses,
  isCountryLicenseSummary,
  LICENSE_COUNTRY_SUMMARY_LIMIT,
  LICENSE_COUNTRY_SUMMARY_WORLD_BBOX,
  parseLicenseCountrySummaryResponse,
} from './licenseCountrySummary';

describe('parseLicenseCountrySummaryResponse', () => {
  it('parses country_summary mode', () => {
    const rows = parseLicenseCountrySummaryResponse({
      mode: 'country_summary',
      countries: [
        { country: 'Ghana', count: 42, lat: 7.5, lng: -1.2 },
        { country: '', count: 1, lat: 0, lng: 0 },
      ],
    });
    expect(rows).toEqual([{ country: 'Ghana', count: 42, lat: 7.5, lng: -1.2 }]);
  });

  it('throws on error payload', () => {
    expect(() => parseLicenseCountrySummaryResponse({ error: 'query_failed' })).toThrow(
      'query_failed',
    );
  });
});

describe('applyCountrySummaryRequestParams', () => {
  it('sets world bbox and summary limit for Go country-summary validation', () => {
    const params: Record<string, string | number | boolean> = {
      prefer_open_data: true,
      limit: 5000,
      map: 1,
      zoom: 5,
      min_lat: 10,
      max_lat: 20,
      min_lng: 30,
      max_lng: 40,
    };
    applyCountrySummaryRequestParams(params);
    expect(params.limit).toBe(LICENSE_COUNTRY_SUMMARY_LIMIT);
    expect(params).toMatchObject(LICENSE_COUNTRY_SUMMARY_WORLD_BBOX);
    expect(params.map).toBeUndefined();
    expect(params.zoom).toBeUndefined();
  });
});

describe('countrySummaryRowsToLicenses', () => {
  it('builds country-summary markers with counts', () => {
    const out = countrySummaryRowsToLicenses([{ country: 'Peru', count: 10, lat: -10, lng: -75 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('country-summary:peru');
    expect(out[0]!.mapClusterCount).toBe(10);
    expect(out[0]!.licenseType).toBe('Country');
    expect(isCountryLicenseSummary(out[0]!)).toBe(true);
  });
});
