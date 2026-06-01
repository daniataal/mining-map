import type { MiningLicense } from '../types';

/** Leaflet LayersControl only registers overlays present on first mount — never gate on entity count. */
export function storageTankFarmsLayerShouldMount(enabled: boolean, mapZoom?: number): boolean {
  if (!enabled) return false;
  if (mapZoom != null && mapZoom < 9) return false;
  return true;
}

export const STORAGE_OPERATOR_UNTAGGED = 'Operator not tagged';

export function formatStorageSourceLabel(
  item: Pick<MiningLicense, 'sourceKind' | 'sourceName'>,
): string {
  if (item.sourceKind === 'curated_reference') {
    return 'Curated reference';
  }
  if (item.sourceName?.trim()) {
    return item.sourceName.trim();
  }
  return 'OpenStreetMap';
}

export function formatStorageOperatorLabel(
  operatorName?: string | null,
  untaggedLabel: string = STORAGE_OPERATOR_UNTAGGED,
): string {
  const trimmed = operatorName?.trim();
  return trimmed ? trimmed : untaggedLabel;
}

export function formatStorageOwnerLabel(ownerName?: string | null): string | null {
  const trimmed = ownerName?.trim();
  return trimmed || null;
}

export function formatStorageSubstanceLabel(item: Pick<MiningLicense, 'substanceText' | 'commodity'>): string | null {
  const substance = item.substanceText?.trim();
  if (substance) return substance;
  const commodity = item.commodity?.trim();
  return commodity || null;
}

export function storageTerminalOsmTagSummary(
  rawPayload?: { tags?: Record<string, unknown> } | null,
): Array<{ key: string; value: string }> {
  const tags = rawPayload?.tags;
  if (!tags || typeof tags !== 'object') return [];
  const priorityKeys = [
    'industrial',
    'man_made',
    'operator',
    'owner',
    'substance',
    'content',
    'product',
    'capacity',
    'capacity:oil',
    'storage_capacity',
    'name',
  ];
  const entries: Array<{ key: string; value: string }> = [];
  for (const key of priorityKeys) {
    const value = tags[key];
    if (value == null || value === '') continue;
    entries.push({ key, value: String(value) });
  }
  return entries;
}
