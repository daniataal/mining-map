import type { MiningLicense } from '../types';
import { refineClusterLandPosition } from './licenseClusterLand';

export type LicenseCountrySummaryRow = {
  country: string;
  count: number;
  lat: number;
  lng: number;
};

export const LICENSE_MAP_BORDER_COUNTRY_CAP = 80;

/** Go country-summary requires a valid bbox; nearly-world extent returns global country hubs. */
export const LICENSE_COUNTRY_SUMMARY_WORLD_BBOX = {
  min_lat: -85,
  max_lat: 85,
  min_lng: -180,
  max_lng: 180,
} as const;

export const LICENSE_COUNTRY_SUMMARY_LIMIT = 120;

/** Normalize viewport fetch params for `/licenses/country-summary`. */
export function applyCountrySummaryRequestParams(
  params: Record<string, string | number | boolean>,
): void {
  delete params.map;
  delete params.zoom;
  params.limit = LICENSE_COUNTRY_SUMMARY_LIMIT;
  Object.assign(params, LICENSE_COUNTRY_SUMMARY_WORLD_BBOX);
}

/** Low-zoom hub markers use this id prefix (distinct from grid `cluster:` cells). */
export function isCountryLicenseSummary(item: MiningLicense | null | undefined): boolean {
  if (!item?.id) return false;
  return item.id.startsWith('country-summary:');
}

export function parseLicenseCountrySummaryResponse(data: unknown): LicenseCountrySummaryRow[] {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if ('error' in obj) {
      throw new Error(String(obj.error ?? 'Country summary request failed'));
    }
    if (obj.mode === 'country_summary' && Array.isArray(obj.countries)) {
      return (obj.countries as LicenseCountrySummaryRow[]).filter(
        (row) =>
          row.country?.trim() &&
          Number.isFinite(row.lat) &&
          Number.isFinite(row.lng) &&
          (row.count ?? 0) > 0,
      );
    }
  }
  return [];
}

/** Map API country-summary rows to server-cluster-shaped license markers. */
export function countrySummaryRowsToLicenses(
  rows: readonly LicenseCountrySummaryRow[],
  sector: MiningLicense['sector'] = 'mining',
): MiningLicense[] {
  return rows.map((row) => {
    const country = row.country.trim();
    const onLand = refineClusterLandPosition(row.lat, row.lng, country);
    const count = row.count;
    return {
      id: `country-summary:${country.toLowerCase()}`,
      company: `${count.toLocaleString()} licenses`,
      licenseType: 'Country',
      commodity: '',
      status: 'Active',
      date: null,
      country,
      region: '',
      sector,
      lat: onLand.lat,
      lng: onLand.lng,
      mapClusterCount: count,
      mapClusterGridDeg: 0,
      entityKind: 'license',
      _displayLat: onLand.lat,
      _displayLng: onLand.lng,
    } as MiningLicense;
  });
}
