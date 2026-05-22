import type { MiningLicense } from '../types';
import { normalizeCountryFocusQuery } from './countryFocusMatch';
import type { LicenseViewportBounds } from './countryBounds';

function countryKeysMatch(a: string, b: string): boolean {
  return normalizeCountryFocusQuery(a) === normalizeCountryFocusQuery(b);
}

/** Case-insensitive country match (aligned with route planner hub filters). */
export function licenseMatchesSelectedCountries(
  item: MiningLicense,
  selectedCountries: readonly string[],
): boolean {
  if (!selectedCountries.length) return true;
  const country = item.country?.trim();
  if (!country) return false;
  return selectedCountries.some((sel) => countryKeysMatch(country, sel.trim()));
}

export function pointInLicenseViewportBounds(
  lat: number,
  lng: number,
  bounds: LicenseViewportBounds,
): boolean {
  return (
    lat >= bounds.south &&
    lat <= bounds.north &&
    lng >= bounds.west &&
    lng <= bounds.east
  );
}

/**
 * Country focus: show rows labeled for the country OR with coords inside the focus bbox
 * (covers mis-tagged open-data rows still drawn inside the country).
 */
export function licenseMatchesCountryFocus(
  item: MiningLicense,
  focusCountry: string,
  focusBounds: LicenseViewportBounds | null,
): boolean {
  const focus = focusCountry.trim();
  if (!focus) return true;
  const country = item.country?.trim();
  if (country && countryKeysMatch(country, focus)) return true;
  if (
    focusBounds &&
    item.lat != null &&
    item.lng != null &&
    pointInLicenseViewportBounds(item.lat, item.lng, focusBounds)
  ) {
    return true;
  }
  return false;
}
