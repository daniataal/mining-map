import type { MiningLicense } from '../types';
import { isOilAndGasLicense } from './licenseHeroImage';
import {
  isFuelMarketerEntity,
  isOilFieldEntity,
  isRefineryEntity,
} from './oilEntityKinds';

export type OilGasPopupKind = 'oil_field' | 'refinery' | 'fuel_marketer' | 'generic';

export interface OilGasPopupRow {
  label: string;
  value: string;
  wide?: boolean;
  href?: string;
}

export interface OilGasLicensePopupModel {
  kind: OilGasPopupKind;
  badgeLabel: string;
  description: string | null;
  operator: string | null;
  operatorMissing: boolean;
  identity: OilGasPopupRow[];
  operations: OilGasPopupRow[];
  source: OilGasPopupRow[];
}

const PRODUCTION_IN_COMMODITY =
  /\s*\(([\d,.]+\s*(?:kb\/d|kbd|mb\/d|mbd|bpd|barrels?\s*(?:per\s*day|\/day)))\)\s*$/i;
const PRODUCTION_INLINE =
  /(~?\s*[\d,.]+\s*(?:kb\/d|kbd|mb\/d|mbd|bpd|million\s+barrels?\s+per\s+day|mb\/d))/i;
const OPERATED_BY = /\boperated\s+by\s+([^.;]+)/i;

export function shouldUseOilGasLicensePopup(
  item: Pick<MiningLicense, 'sector' | 'commodity' | 'entityKind'>
): boolean {
  if (item.entityKind === 'storage_terminal') return false;
  return isOilAndGasLicense(item.sector, item.commodity);
}

export function resolveOilGasPopupKind(
  item: Pick<
    MiningLicense,
    'entitySubtype' | 'licenseType' | 'sector' | 'commodity'
  >
): OilGasPopupKind {
  if (isFuelMarketerEntity(item)) return 'fuel_marketer';
  if (isRefineryEntity(item)) return 'refinery';
  if (isOilFieldEntity(item)) return 'oil_field';
  return 'generic';
}

export function formatOilGasSubtypeBadge(
  kind: OilGasPopupKind,
  entitySubtype?: string | null
): string {
  switch (kind) {
    case 'oil_field':
      return 'OIL FIELD';
    case 'refinery':
      return 'REFINERY';
    case 'fuel_marketer':
      return 'FUEL MARKETER';
    default: {
      const sub = (entitySubtype || '').trim().replaceAll('_', ' ');
      return sub ? sub.toUpperCase() : 'OIL & GAS';
    }
  }
}

export function parseProductionFromCommodity(commodity?: string | null): {
  baseCommodity: string | null;
  production: string | null;
} {
  const raw = (commodity || '').trim();
  if (!raw) return { baseCommodity: null, production: null };

  const paren = raw.match(PRODUCTION_IN_COMMODITY);
  if (paren) {
    return {
      baseCommodity: raw.slice(0, paren.index).trim() || raw,
      production: paren[1].trim(),
    };
  }

  const inline = raw.match(PRODUCTION_INLINE);
  if (inline) {
    return { baseCommodity: raw, production: inline[0].trim() };
  }

  return { baseCommodity: raw, production: null };
}

export function parseCapacityFromEnrichment(
  enrichmentNote?: string | null,
  capacityText?: string | null,
  capacity?: number | null
): string | null {
  const explicit = (capacityText || '').trim();
  if (explicit) return explicit;
  if (typeof capacity === 'number' && capacity > 0) {
    return `${capacity.toLocaleString()} kb/d`;
  }
  const note = (enrichmentNote || '').trim();
  if (!note) return null;
  const match = note.match(/~?\s*([\d,.]+\s*(?:kb\/d|kbd|mb\/d|mbd|bpd))/i);
  return match ? match[0].trim() : null;
}

export function extractOperatorFromEnrichment(enrichmentNote?: string | null): string | null {
  const note = (enrichmentNote || '').trim();
  if (!note) return null;
  const match = note.match(OPERATED_BY);
  return match?.[1]?.trim() || null;
}

export function resolveOilGasOperator(
  item: Pick<
    MiningLicense,
    'operatorName' | 'company' | 'licenseType' | 'enrichmentNote'
  >
): string | null {
  const tagged = (item.operatorName || '').trim();
  if (tagged) return tagged;

  const fromNote = extractOperatorFromEnrichment(item.enrichmentNote);
  if (fromNote) return fromNote;

  const lt = (item.licenseType || '').trim().toLowerCase();
  if (
    lt.includes('operating company') ||
    lt.includes('national oil company') ||
    lt.includes('marketing company')
  ) {
    const company = (item.company || '').trim();
    return company || null;
  }

  return null;
}

function pushRow(rows: OilGasPopupRow[], label: string, value?: string | null, opts?: Partial<OilGasPopupRow>) {
  const trimmed = (value || '').trim();
  if (!trimmed) return;
  rows.push({ label, value: trimmed, ...opts });
}

function trustLabel(score?: number | null): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return `${Math.round(score * 100)}%`;
}

function buildSourceRows(item: MiningLicense): OilGasPopupRow[] {
  const rows: OilGasPopupRow[] = [];
  pushRow(rows, 'Source', item.sourceName);
  const trust = trustLabel(item.confidenceScore);
  if (trust) pushRow(rows, 'Trust', trust);
  pushRow(rows, 'Confidence', item.confidenceNote, { wide: true });
  pushRow(rows, 'Provenance', item.provenanceNote, { wide: true });
  pushRow(rows, 'Record origin', item.recordOrigin?.replaceAll('_', ' '));
  pushRow(rows, 'Coverage', item.coverageState);
  const url = (item.sourceRecordUrl || item.sourceUrl || '').trim();
  if (url) {
    rows.push({
      label: 'External link',
      value: url.replace(/^https?:\/\//i, '').slice(0, 48) + (url.length > 52 ? '…' : ''),
      href: url,
      wide: true,
    });
  }
  if (item.lastSyncedAt) {
    pushRow(rows, 'Last synced', new Date(item.lastSyncedAt).toLocaleDateString());
  }
  return rows;
}

export function buildOilGasLicensePopupModel(item: MiningLicense): OilGasLicensePopupModel {
  const kind = resolveOilGasPopupKind(item);
  const { baseCommodity, production } = parseProductionFromCommodity(item.commodity);
  const operator = resolveOilGasOperator(item);
  const enrichment = (item.enrichmentNote || '').trim() || null;
  const capacity = parseCapacityFromEnrichment(
    enrichment,
    item.capacityText,
    item.capacity
  );

  const identity: OilGasPopupRow[] = [];
  const operations: OilGasPopupRow[] = [];

  pushRow(identity, 'Field / facility type', item.licenseType, { wide: true });
  pushRow(identity, 'Region', item.region, { wide: true });
  pushRow(identity, 'Country', item.country);
  if (item.sector) pushRow(identity, 'Sector', item.sector);
  if (item.date) pushRow(identity, 'Date issued', item.date);

  if (kind === 'oil_field') {
    pushRow(operations, 'Commodity', baseCommodity);
    pushRow(operations, 'Production', production);
    if (!production && enrichment) {
      const prodFromNote = parseCapacityFromEnrichment(enrichment);
      if (prodFromNote) pushRow(operations, 'Production', prodFromNote);
    }
    pushRow(operations, 'Status', item.status);
    pushRow(operations, 'Operator', operator);
  } else if (kind === 'refinery') {
    pushRow(operations, 'Capacity', capacity);
    pushRow(operations, 'Products', baseCommodity || item.commodity);
    pushRow(operations, 'Status', item.status);
    pushRow(operations, 'Operator', operator);
  } else if (kind === 'fuel_marketer') {
    pushRow(operations, 'Products licensed', baseCommodity || item.commodity, { wide: true });
    pushRow(operations, 'License type', item.licenseType, { wide: true });
    pushRow(operations, 'Status', item.status);
    pushRow(operations, 'Regulator / source', item.sourceName);
    const regUrl = (item.sourceRecordUrl || '').trim();
    if (regUrl) {
      operations.push({
        label: 'Regulator link',
        value: regUrl.replace(/^https?:\/\//i, '').slice(0, 52),
        href: regUrl,
        wide: true,
      });
    }
  } else {
    pushRow(operations, 'Commodity', item.commodity, { wide: true });
    pushRow(operations, 'License type', item.licenseType, { wide: true });
    pushRow(operations, 'Status', item.status);
    pushRow(operations, 'Production / capacity', production || capacity);
    pushRow(operations, 'Operator', operator);
    pushRow(operations, 'Phone', item.phoneNumber);
    pushRow(operations, 'Contact', item.contactPerson);
    pushRow(operations, 'Source ID', item.sourceId);
  }

  const description =
    enrichment &&
    !operations.some((r) => r.value === enrichment) &&
    kind !== 'fuel_marketer'
      ? enrichment
      : enrichment && kind === 'fuel_marketer'
        ? null
        : enrichment;

  return {
    kind,
    badgeLabel: formatOilGasSubtypeBadge(kind, item.entitySubtype),
    description,
    operator,
    operatorMissing: !operator && (kind === 'oil_field' || kind === 'refinery'),
    identity,
    operations,
    source: buildSourceRows(item),
  };
}
