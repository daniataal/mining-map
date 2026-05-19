import type { MiningLicense } from '../types';

const UNKNOWN_NAME_LABELS = new Set([
  'unknown',
  'unknown license',
  'name unknown',
  'unknown name',
  'unnamed',
  'n/a',
  'na',
  'none',
  'null',
  'not available',
  'not known',
  '-',
  '—',
]);

/** True when the display name is empty or a generic unknown placeholder. */
export function isUnknownLicenseName(company?: string | null): boolean {
  const normalized = (company || '').trim().toLowerCase();
  if (!normalized) return true;
  if (UNKNOWN_NAME_LABELS.has(normalized)) return true;
  return normalized.startsWith('unknown ');
}

/** Open reference rows tagged as global-fallback-only (not official registry sync). */
export function isGlobalFallbackOnlyLicense(item: MiningLicense): boolean {
  const coverage = (item.coverageState || '').trim().toLowerCase();
  if (coverage === 'global_fallback_only') return true;
  const origin = (item.recordOrigin || '').trim().toLowerCase();
  const kind = (item.sourceKind || '').trim().toLowerCase();
  return origin === 'global_open_fallback' || kind === 'global_open_fallback';
}

/**
 * Placeholder global-fallback rows (unknown name + fallback-only provenance) should not
 * appear in default sidebar/map/search results.
 */
export function isHiddenFallbackPlaceholder(item: MiningLicense): boolean {
  return isGlobalFallbackOnlyLicense(item) && isUnknownLicenseName(item.company);
}

export function excludeHiddenFallbackPlaceholders(items: MiningLicense[]): MiningLicense[] {
  return items.filter((item) => !isHiddenFallbackPlaceholder(item));
}
