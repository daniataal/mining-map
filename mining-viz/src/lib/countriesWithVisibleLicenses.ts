import type { MiningLicense } from '../types';

export function licenseHasMapCoordinates(item: MiningLicense): boolean {
  const lat = item.lat;
  const lng = item.lng;
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}

/** Unique country names with at least one plottable license in the given (filtered) set. */
export function countriesWithVisibleLicenses(licenses: readonly MiningLicense[]): string[] {
  const ordered: string[] = [];
  const seenKey = new Set<string>();
  for (const item of licenses) {
    if (!licenseHasMapCoordinates(item)) continue;
    const raw = item.country?.trim();
    if (!raw) continue;
    const dedupeKey = raw.toLowerCase();
    if (seenKey.has(dedupeKey)) continue;
    seenKey.add(dedupeKey);
    ordered.push(raw);
  }
  return ordered.sort((a, b) => a.localeCompare(b));
}

/** Per-country counts for map badges / summaries — only licenses with coordinates. */
export function countryLicenseCounts(
  licenses: readonly MiningLicense[],
): Array<{ country: string; count: number }> {
  const byKey = new Map<string, { country: string; count: number }>();
  for (const item of licenses) {
    if (!licenseHasMapCoordinates(item)) continue;
    const raw = item.country?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const row = byKey.get(key);
    if (row) {
      row.count += 1;
    } else {
      byKey.set(key, { country: raw, count: 1 });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.count - a.count || a.country.localeCompare(b.country),
  );
}

/** Weighted counts for country border selection (server clusters use mapClusterCount). */
export function countryLicenseCountsForBorders(
  licenses: readonly MiningLicense[],
): Array<{ country: string; count: number }> {
  const byKey = new Map<string, { country: string; count: number }>();
  for (const item of licenses) {
    if (!licenseHasMapCoordinates(item)) continue;
    const raw = item.country?.trim();
    if (!raw) continue;
    const weight =
      typeof item.mapClusterCount === 'number' && item.mapClusterCount > 0
        ? item.mapClusterCount
        : 1;
    const key = raw.toLowerCase();
    const row = byKey.get(key);
    if (row) {
      row.count += weight;
    } else {
      byKey.set(key, { country: raw, count: weight });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => b.count - a.count || a.country.localeCompare(b.country),
  );
}

/** Countries to request outlines for — mirrors markers on the map (no separate global ranking). */
export function countriesForMapBorders(
  licenses: readonly MiningLicense[],
  maxCountries = 80,
): string[] {
  const ranked = countryLicenseCountsForBorders(licenses);
  if (ranked.length <= maxCountries) {
    return ranked.map((row) => row.country);
  }
  return ranked.slice(0, maxCountries).map((row) => row.country);
}
