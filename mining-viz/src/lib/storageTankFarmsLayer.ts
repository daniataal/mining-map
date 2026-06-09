import type { MiningLicense } from '../types';
import { isUnknownLicenseName } from './licenseVisibility';
import {
  formatStoragePopupTitle,
} from './storageTerminalPopup';

import { haversineMeters } from './pipelineMapPick';

/** Max distance to fuse an OSM storage click with a curated DB storage terminal. */
export const STORAGE_TERMINAL_FUSION_MAX_M = 2500;

export function findNearestStorageTerminal(
  entities: MiningLicense[],
  lat: number,
  lng: number,
  maxDistanceM = STORAGE_TERMINAL_FUSION_MAX_M,
): MiningLicense | null {
  let best: MiningLicense | null = null;
  let bestDistance = maxDistanceM + 1;
  for (const item of entities) {
    const itemLat = item.lat;
    const itemLng = item.lng;
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) continue;
    const distance = haversineMeters(lat, lng, itemLat, itemLng);
    if (distance <= maxDistanceM && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

/** Leaflet LayersControl only registers overlays present on first mount — never gate on entity count. */
export function storageTankFarmsLayerShouldMount(enabled: boolean, _mapZoom?: number): boolean {
  return enabled;
}

/** Tank farms are extremely dense globally; keep low zoom as coarse hub aggregates. */
export function storageTankFarmClusterGridMultiplier(mapZoom: number | undefined): number {
  const z = mapZoom ?? 5;
  if (z < 5) return 7;
  if (z < 7) return 4.5;
  if (z < 9) return 2.5;
  return 1;
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

/** Canvas / hover label: operator first, then capacity when known. */
export function formatStorageMapFeatureLabels(
  item: Pick<
    MiningLicense,
    | 'company'
    | 'operatorName'
    | 'ownerName'
    | 'capacityText'
    | 'capacity'
    | 'country'
    | 'entitySubtype'
    | 'locode'
    | 'nearbyPort'
    | 'region'
    | 'siteContextName'
    | 'sourceId'
  >,
): { title: string; subtitle: string | null } {
  const title = formatStoragePopupTitle(item);
  const parts: string[] = [];
  const operator = item.operatorName?.trim();
  if (operator && operator !== title) parts.push(operator);
  const capacity =
    item.capacityText?.trim() ||
    (typeof item.capacity === 'number' && item.capacity > 0 ? String(item.capacity) : null);
  if (capacity) parts.push(capacity);
  const country = item.country?.trim();
  if (country && !parts.includes(country)) parts.push(country);
  return { title, subtitle: parts.length > 0 ? parts.join(' · ') : null };
}

export function formatStorageSubstanceLabel(item: Pick<MiningLicense, 'substanceText' | 'commodity'>): string | null {
  const substance = item.substanceText?.trim();
  if (substance) return substance;
  const commodity = item.commodity?.trim();
  return commodity || null;
}

const GENERIC_STORAGE_TERMINAL_TITLES = new Set([
  'unnamed storage terminal',
  'unnamed storage tank',
  'storage tank',
  'storage terminal',
]);

/** True when popup title is a placeholder, not a tagged facility or operator name. */
export function isGenericStorageTerminalTitle(company?: string | null): boolean {
  if (isUnknownLicenseName(company)) return true;
  const normalized = (company || '').trim().toLowerCase();
  if (GENERIC_STORAGE_TERMINAL_TITLES.has(normalized)) return true;
  return /^unnamed\s+storage\b/i.test((company || '').trim());
}

export function formatStorageSiteContextNearLine(siteContextName?: string | null): string | null {
  const name = siteContextName?.trim();
  if (!name) return null;
  return `Near ${name}`;
}

export function shouldShowStorageSiteContextNear(
  item: Pick<MiningLicense, 'company' | 'siteContextName'>,
): boolean {
  return Boolean(
    item.siteContextName?.trim() && isGenericStorageTerminalTitle(item.company),
  );
}

export const STORAGE_SITE_CONTEXT_INFERRED_BADGE = 'Inferred from OSM site';

/** Popup/map badge when a lone OSM tank node lacks terminal-grade evidence. */
export function formatStorageBadgeLabel(
  item: Pick<MiningLicense, 'entitySubtype' | 'confidenceScore' | 'coverageState'>,
): string {
  if (
    item.entitySubtype === 'storage_tank' &&
    (item.coverageState === 'sparse_osm_node' || (item.confidenceScore ?? 1) < 0.7)
  ) {
    return 'OSM tank node (unverified)';
  }
  if (item.entitySubtype === 'storage_tank') {
    return 'Storage tank';
  }
  if (item.entitySubtype === 'tank_farm') {
    return 'Tank farm';
  }
  if (item.entitySubtype === 'fuel_depot') {
    return 'Fuel depot';
  }
  return 'Storage terminal';
}

export function formatStorageLocatorContext(
  item: Pick<
    MiningLicense,
    | 'locode'
    | 'nearbyPort'
    | 'operatorName'
    | 'siteContextName'
    | 'region'
    | 'country'
    | 'subdivision'
  >,
): string {
  const segments: string[] = [];
  const siteName = item.siteContextName?.trim();
  if (siteName) {
    segments.push(siteName);
  } else if (item.locode?.trim()) {
    segments.push(item.locode.trim());
  }

  const region = item.region?.trim();
  const country = item.country?.trim();
  const subdivision = item.subdivision?.trim();
  const localityParts = [region, subdivision].filter(
    (part): part is string => Boolean(part) && part !== country,
  );
  if (country) localityParts.push(country);
  const locality = localityParts.join(', ');
  if (locality) segments.push(locality);

  if (item.nearbyPort?.name?.trim()) {
    segments.push(item.nearbyPort.name.trim());
  } else if (!siteName && item.operatorName?.trim()) {
    segments.push(item.operatorName.trim());
  }

  if (segments.length === 0) return '—';
  return segments.join(' · ');
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
