import type { PetroleumLayerId } from './petroleumLayers';

export interface PetroleumFeatureViewModel {
  title: string | null;
  subtitle: string | null;
  facilityType: string | null;
  operator: string | null;
  exploringCompanies: string[];
  country: string | null;
  status: string | null;
  sector: string | null;
  capacity: string | null;
  source: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  description: string | null;
  extraRows: { label: string; value: string }[];
}

const LAYER_TYPE_LABEL: Record<PetroleumLayerId, string> = {
  exploration: 'Exploration block',
  production: 'Production field',
  bid_rounds: 'Bid round',
  refineries: 'Refinery',
  oil_pipelines: 'Oil pipeline',
  gas_pipelines: 'Gas pipeline',
};

/** ISO-2/3 codes and oilmap dataset prefixes → display country. */
const ISO_COUNTRY_NAMES: Record<string, string> = {
  AO: 'Angola',
  AR: 'Argentina',
  BR: 'Brazil',
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  CI: "Côte d'Ivoire",
  CO: 'Colombia',
  DZ: 'Algeria',
  EC: 'Ecuador',
  ET: 'Ethiopia',
  GA: 'Gabon',
  GQ: 'Equatorial Guinea',
  IL: 'Israel',
  KE: 'Kenya',
  LR: 'Liberia',
  LY: 'Libya',
  MA: 'Morocco',
  ML: 'Mali',
  MR: 'Mauritania',
  MX: 'Mexico',
  MY: 'Myanmar',
  NA: 'Namibia',
  NG: 'Nigeria',
  NL: 'Netherlands',
  NO: 'Norway',
  NOR: 'Norway',
  PE: 'Peru',
  SY: 'Syria',
  TD: 'Chad',
  TN: 'Tunisia',
  TR: 'Turkey',
  TZ: 'Tanzania',
  UK: 'United Kingdom',
  VE: 'Venezuela',
  YE: 'Yemen',
  ZA: 'South Africa',
  ZM: 'Zambia',
};

const COMPANY_PROPERTY_KEYS = [
  'Company',
  'company',
  'OPERATOR',
  'Operator',
  'operator',
  'licensee',
  'Licensee',
  'LICENSEE',
  'contractor',
  'Contractor',
  'CONTRACTOR',
  'block_holder',
  'Block_Holder',
  'holder',
  'Holder',
  'Descriptio',
  'DESCRIPTION',
  'Description',
  'partners',
  'Partners',
  'investor',
  'Investor',
  'JV',
  'jv_partner',
];

const CONSUMED_PROPERTY_KEYS = new Set([
  'Name',
  'NAME',
  'name',
  'title',
  'Title',
  'Country',
  'COUNTRY',
  'country',
  'Nation',
  'Type',
  'TYPE',
  'type',
  'category',
  'Category',
  'STATUS',
  'Status',
  'status',
  'State',
  'Sector',
  'sector',
  'Commodity',
  'commodity',
  'Capacity',
  'capacity',
  'CAPACITY',
  'bpd',
  'BPD',
  'throughput',
  'description',
  'Description',
  'notes',
  'Notes',
  'Source',
  'SOURCE',
  'source',
  'link',
  'Link',
  'URL',
  'url',
  'source_layer',
  ...COMPANY_PROPERTY_KEYS,
]);

export function petroleumLayerTypeLabel(layerId: PetroleumLayerId): string {
  return LAYER_TYPE_LABEL[layerId] ?? 'Infrastructure';
}

function firstString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const raw = props[key];
    if (raw == null) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return null;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** True when oilmap encodes a dataset id in Country (e.g. NA_contracts). */
export function isOilmapDatasetCountry(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[A-Z]{2,3}_contracts\+?$/i.test(trimmed)) return true;
  if (/_contracts/i.test(trimmed)) return true;
  return false;
}

/** Map oilmap Country codes and dataset ids to a human country name. */
export function resolvePetroleumCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || isOilmapDatasetCountry(trimmed)) {
    const datasetMatch = trimmed.match(/^([A-Z]{2})_contracts/i);
    if (datasetMatch) {
      return ISO_COUNTRY_NAMES[datasetMatch[1].toUpperCase()] ?? null;
    }
    if (!trimmed || isOilmapDatasetCountry(trimmed)) {
      return null;
    }
  }

  const upper = trimmed.toUpperCase();
  if (ISO_COUNTRY_NAMES[upper]) {
    return ISO_COUNTRY_NAMES[upper];
  }

  if (/^[A-Z]{2}$/.test(trimmed)) {
    return ISO_COUNTRY_NAMES[upper] ?? null;
  }

  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) {
    return trimmed
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return trimmed;
}

/** Extract URL and label from plain URLs or oilmap HTML anchor Source fields. */
export function parsePetroleumSource(
  raw: string | null | undefined
): { sourceUrl: string | null; sourceLabel: string | null; sourceText: string | null } {
  if (raw == null) return { sourceUrl: null, sourceLabel: null, sourceText: null };
  const trimmed = String(raw).trim();
  if (!trimmed) return { sourceUrl: null, sourceLabel: null, sourceText: null };

  const anchorMatch = trimmed.match(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
  );
  if (anchorMatch) {
    const sourceUrl = anchorMatch[1].trim();
    const inner = anchorMatch[2].replace(/<[^>]+>/g, '').trim();
    const sourceLabel = inner || sourceUrl;
    return { sourceUrl, sourceLabel, sourceText: null };
  }

  if (isUrl(trimmed)) {
    return { sourceUrl: trimmed, sourceLabel: trimmed, sourceText: null };
  }

  return { sourceUrl: null, sourceLabel: null, sourceText: trimmed };
}

/** Collect operator / licensee names from common oilmap property keys. */
export function collectExploringCompanies(props: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const companies: string[] = [];

  const addCompany = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned || cleaned.length < 2) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    companies.push(cleaned);
  };

  const splitCompanyList = (raw: string) => {
    for (const part of raw.split(/[,;|]|\s+\/\s+|\s+&\s+|\band\b/gi)) {
      addCompany(part);
    }
  };

  for (const key of COMPANY_PROPERTY_KEYS) {
    const raw = props[key];
    if (raw == null) continue;
    splitCompanyList(String(raw));
  }

  return companies;
}

/** Normalize heterogeneous oilmap tile properties into a stable popup view model. */
export function buildPetroleumFeatureViewModel(
  props: Record<string, unknown>,
  layerId: PetroleumLayerId
): PetroleumFeatureViewModel {
  const name = firstString(props, ['Name', 'NAME', 'name', 'title', 'Title']);
  const exploringCompanies = collectExploringCompanies(props);
  const operator = exploringCompanies.length === 1 ? exploringCompanies[0] : null;
  const countryRaw = firstString(props, ['Country', 'COUNTRY', 'country', 'Nation']);
  const country = resolvePetroleumCountry(countryRaw);
  const facilityType =
    firstString(props, ['Type', 'TYPE', 'type', 'category', 'Category']) ??
    petroleumLayerTypeLabel(layerId);
  const status = firstString(props, ['STATUS', 'Status', 'status', 'State']);
  const sector = firstString(props, ['Sector', 'sector', 'Commodity', 'commodity']);
  const capacity = firstString(props, [
    'Capacity',
    'capacity',
    'CAPACITY',
    'bpd',
    'BPD',
    'throughput',
  ]);
  const description = firstString(props, ['description', 'Description', 'notes', 'Notes']);
  const sourceRaw = firstString(props, ['Source', 'SOURCE', 'source', 'link', 'Link', 'URL', 'url']);
  const { sourceUrl, sourceLabel, sourceText } = parsePetroleumSource(sourceRaw);

  const extraRows: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (CONSUMED_PROPERTY_KEYS.has(key) || raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    extraRows.push({ label: humanizeKey(key), value });
  }
  extraRows.sort((a, b) => a.label.localeCompare(b.label));

  const title = name ?? (exploringCompanies[0] ?? null) ?? facilityType ?? 'Unnamed feature';

  const subtitle = country && title !== country ? country : null;

  return {
    title,
    subtitle,
    facilityType,
    operator: exploringCompanies.length === 1 ? operator : null,
    exploringCompanies,
    country,
    status,
    sector,
    capacity,
    source: sourceText,
    sourceUrl,
    sourceLabel,
    description,
    extraRows: extraRows.slice(0, 4),
  };
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
}
