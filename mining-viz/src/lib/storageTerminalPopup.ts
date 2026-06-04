import type { MiningLicense } from '../types';
import { licenseCardTitle } from './licenseSidebarCard';
import { isUnknownLicenseName } from './licenseVisibility';
import {
  formatStorageLocatorContext,
  formatStorageOwnerLabel,
  formatStorageSiteContextNearLine,
  formatStorageSourceLabel,
  formatStorageBadgeLabel,
  formatStorageSubstanceLabel,
  isGenericStorageTerminalTitle,
  shouldShowStorageSiteContextNear,
} from './storageTankFarmsLayer';

export interface StorageTerminalPopupRow {
  label: string;
  value: string;
}

export interface StorageTerminalPopupModel {
  title: string;
  subtitle: string | null;
  badgeLabel: string;
  subtypeLabel: string | null;
  operator: string | null;
  operatorMissing: boolean;
  detailRows: StorageTerminalPopupRow[];
  sourceLabel: string;
  sourceShortLabel: string;
  confidencePercent: number | null;
  confidenceNote: string | null;
  sourceRecordUrl: string | null;
  enrichmentSourceUrl: string | null;
  curatedEnrichmentSourceName: string | null;
  curatedEnrichmentDistanceKm: number | null;
  referenceEnrichmentKind: string | null;
  geoApproximated: boolean;
  geoSource: string | null;
  lastSyncedAt: string | null;
  lat: number | null;
  lng: number | null;
}

function pushRow(rows: StorageTerminalPopupRow[], label: string, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '—' || isUnknownLicenseName(trimmed)) return;
  rows.push({ label, value: trimmed });
}

export function formatStorageSourceShortLabel(sourceName?: string | null): string {
  const name = (sourceName || '').trim();
  if (!name) return 'OpenStreetMap';
  if (/offline bulk seed/i.test(name)) return 'OSM (offline seed)';
  if (/openstreetmap via overpass/i.test(name)) return 'OSM (Overpass)';
  if (/^openstreetmap\b/i.test(name)) return 'OpenStreetMap';
  if (name.length > 36) return `${name.slice(0, 33)}…`;
  return name;
}

export function formatStoragePopupTitle(
  item: Pick<
    MiningLicense,
    | 'company'
    | 'operatorName'
    | 'ownerName'
    | 'sourceId'
    | 'region'
    | 'country'
    | 'siteContextName'
    | 'entitySubtype'
    | 'locode'
    | 'nearbyPort'
    | 'subdivision'
  >,
): string {
  if (shouldShowStorageSiteContextNear(item)) {
    const near = formatStorageSiteContextNearLine(item.siteContextName);
    if (near) return near;
  }

  if (isGenericStorageTerminalTitle(item.company)) {
    const operator = item.operatorName?.trim();
    if (operator && !isUnknownLicenseName(operator)) return operator;
    const owner = item.ownerName?.trim();
    if (owner && !isUnknownLicenseName(owner)) return owner;
  }

  const title = licenseCardTitle(item);
  if (
    !isGenericStorageTerminalTitle(title) &&
    title !== 'License record' &&
    !isUnknownLicenseName(title)
  ) {
    return title;
  }

  const locator = formatStorageLocatorContext(item);
  if (locator !== '—') {
    const first = locator.split(' · ')[0]?.trim();
    if (first && !isUnknownLicenseName(first)) return first;
  }

  const subtype = item.entitySubtype?.replaceAll('_', ' ');
  if (subtype && !isGenericStorageTerminalTitle(subtype)) return subtype;
  return 'Storage terminal';
}

export function formatStoragePopupSubtitle(
  item: Pick<MiningLicense, 'country' | 'region' | 'status'>,
): string | null {
  const parts: string[] = [];
  const country = item.country?.trim();
  if (country && !isUnknownLicenseName(country)) parts.push(country);
  const region = item.region?.trim();
  if (region && !isUnknownLicenseName(region) && region !== country) parts.push(region);
  const status = item.status?.trim();
  if (status) parts.push(status);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatStorageOperatorDisplay(
  item: Pick<
    MiningLicense,
    'operatorName' | 'operatorAssignmentKind' | 'operatorPartitionInferred' | 'portTenantName'
  >,
): { label: string; inferred: boolean } {
  const operator = item.operatorName?.trim();
  if (!operator) return { label: '', inferred: false };
  const inferred =
    Boolean(item.operatorPartitionInferred) ||
    item.operatorAssignmentKind === 'foiz_osm_partition_inferred' ||
    item.operatorAssignmentKind === 'port_authority_osm_anchor';
  if (inferred) {
    return { label: `Inferred zone · ${operator}`, inferred: true };
  }
  return { label: operator, inferred: false };
}

export function buildStorageTerminalPopupModel(item: MiningLicense): StorageTerminalPopupModel {
  const operatorDisplay = formatStorageOperatorDisplay(item);
  const operatorTrimmed = operatorDisplay.label || null;
  const operatorMissing = !operatorTrimmed;

  const detailRows: StorageTerminalPopupRow[] = [];
  pushRow(detailRows, 'Owner', formatStorageOwnerLabel(item.ownerName));
  pushRow(detailRows, 'Substance', formatStorageSubstanceLabel(item));

  const capacity =
    item.capacityText ||
    (typeof item.capacity === 'number' && item.capacity > 0 ? String(item.capacity) : null);
  pushRow(detailRows, 'Capacity', capacity);

  const nearbyPort = item.nearbyPort?.name?.trim();
  if (nearbyPort) {
    pushRow(detailRows, 'Nearest port', nearbyPort);
  }

  const locator = formatStorageLocatorContext(item);
  if (locator !== '—') {
    pushRow(detailRows, 'Locator', locator);
  }

  if (item.sector?.trim()) {
    pushRow(detailRows, 'Sector', item.sector.replaceAll('_', ' '));
  }

  return {
    title: formatStoragePopupTitle(item),
    subtitle: formatStoragePopupSubtitle(item),
    badgeLabel: formatStorageBadgeLabel(item),
    subtypeLabel: item.entitySubtype?.replaceAll('_', ' ') ?? null,
    operator: operatorTrimmed || null,
    operatorMissing,
    detailRows,
    sourceLabel: formatStorageSourceLabel(item),
    sourceShortLabel: formatStorageSourceShortLabel(item.sourceName),
    confidencePercent:
      typeof item.confidenceScore === 'number' ? Math.round(item.confidenceScore * 100) : null,
    confidenceNote: item.confidenceNote?.trim() || null,
    sourceRecordUrl: (item.sourceRecordUrl || item.sourceUrl || '').trim() || null,
    enrichmentSourceUrl: (item.enrichmentSourceUrl || '').trim() || null,
    curatedEnrichmentSourceName: (item.curatedEnrichmentSourceName || '').trim() || null,
    curatedEnrichmentDistanceKm:
      typeof item.curatedEnrichmentDistanceKm === 'number'
        ? item.curatedEnrichmentDistanceKm
        : null,
    referenceEnrichmentKind: (item.referenceEnrichmentKind || '').trim() || null,
    geoApproximated: Boolean(item.geoApproximated),
    geoSource: item.geoSource?.trim() || null,
    lastSyncedAt: item.lastSyncedAt,
    lat: item._displayLat ?? item.lat ?? null,
    lng: item._displayLng ?? item.lng ?? null,
  };
}
