import type { MiningLicense, UserAnnotation } from '../types';

/** Precomputed lowercase haystack per license id for O(1) lookup during search. */
export type LicenseSearchIndex = Map<string, string>;

const GENERIC_LICENSE_TYPE_FOR_SEARCH = new Set(['unknown', 'unknown license', 'license']);

function licenseTypeForSearch(item: MiningLicense, annotation: UserAnnotation): string {
  const raw = (annotation.licenseType || item.licenseType || '').trim();
  const normalized = raw.toLowerCase();
  return GENERIC_LICENSE_TYPE_FOR_SEARCH.has(normalized) ? '' : raw;
}

export function buildLicenseSearchIndex(
  items: MiningLicense[],
  userAnnotations: Record<string, UserAnnotation>,
): LicenseSearchIndex {
  const index: LicenseSearchIndex = new Map();
  for (const item of items) {
    const annotation = userAnnotations[item.id] || {};
    const commodity = annotation.commodity || item.commodity || '';
    const parts = [
      item.company,
      licenseTypeForSearch(item, annotation),
      item.operatorName,
      item.nearbyPort?.name,
      item.entitySubtype,
      item.locode,
      item.country,
      commodity,
      annotation.comment,
    ];
    index.set(
      item.id,
      parts
        .filter((part): part is string => Boolean(part && String(part).trim()))
        .join('\u0000')
        .toLowerCase(),
    );
  }
  return index;
}

export function licenseHaystackMatches(index: LicenseSearchIndex, itemId: string, lowerQuery: string): boolean {
  if (!lowerQuery) return true;
  const haystack = index.get(itemId);
  return haystack ? haystack.includes(lowerQuery) : false;
}
