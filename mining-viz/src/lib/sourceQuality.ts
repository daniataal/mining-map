import type { MiningLicense } from '../types';

export type SourceQualityTier = 'official' | 'imported' | 'fallback' | 'unknown';

const FALLBACK_KINDS = new Set(['bundled_json', 'global_open_fallback', 'unknown']);
const IMPORT_KINDS = new Set(['user_import_csv']);

export function sourceQualityTier(item: Pick<MiningLicense, 'sourceKind' | 'recordOrigin' | 'coverageState'>): SourceQualityTier {
  const kind = (item.sourceKind || '').toLowerCase();
  const origin = (item.recordOrigin || '').toLowerCase();
  const coverage = (item.coverageState || '').toLowerCase();

  if (kind === 'official_registry' || origin.includes('official') || coverage === 'official_live') {
    return 'official';
  }
  if (IMPORT_KINDS.has(kind) || origin.includes('user_import') || origin.includes('csv')) {
    return 'imported';
  }
  if (FALLBACK_KINDS.has(kind) || coverage.includes('fallback') || origin.includes('bundled')) {
    return 'fallback';
  }
  return 'unknown';
}

export function sourceQualityLabel(tier: SourceQualityTier): string {
  switch (tier) {
    case 'official':
      return 'Official registry';
    case 'imported':
      return 'Imported CSV';
    case 'fallback':
      return 'Fallback / unverified';
    default:
      return 'Source unclassified';
  }
}

export function sourceQualityWarning(tier: SourceQualityTier): string | null {
  if (tier === 'fallback') {
    return 'Record provenance is fallback-only — verify against an official registry before approving the deal.';
  }
  if (tier === 'unknown') {
    return 'Source tier is unclear — refresh open-data sync or confirm license with the authority.';
  }
  return null;
}

export function blocksStrongDdApproval(tier: SourceQualityTier): boolean {
  return tier === 'fallback';
}
