import type { PetroleumLayerId } from './petroleumLayers';
import {
  classifyPipelineSubstance,
  pipelineSubstanceDisplayLabel,
  type PipelineSubstance,
} from './pipelineSubstance';

export interface PetroleumFeatureViewModel {
  title: string | null;
  subtitle: string | null;
  facilityType: string | null;
  pipelineSubstance: PipelineSubstance | null;
  pipelineBadgeLabel: string | null;
  operator: string | null;
  owner: string | null;
  operatorMissing: boolean;
  exploringCompanies: string[];
  country: string | null;
  status: string | null;
  sector: string | null;
  capacity: string | null;
  source: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  description: string | null;
  osmUrl: string | null;
  wikipediaUrl: string | null;
  wikidataUrl: string | null;
  isOsmFeature: boolean;
  pipelineDetails: { label: string; value: string }[];
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
  'Operator(s)',
  'owner',
  'Owner',
  'OWNER',
  'Owner(s)',
  'Parent(s)',
  'primary_counterparty',
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
  'osm_type',
  'osm_id',
  'layer_id',
  'attribution',
  'persisted',
  'man_made',
  'substance',
  'pipeline_substance',
  'pipelineSubstance',
  'diameter',
  'ref',
  'network',
  'location',
  'voltage',
  'wikipedia',
  'wikidata',
  'start_date',
  'end_date',
  'usage',
  'owner',
  'Owner',
  'OWNER',
]);

const PIPELINE_LAYER_IDS = new Set<PetroleumLayerId>(['oil_pipelines', 'gas_pipelines']);

const OSM_PIPELINE_DETAIL_SPECS: { label: string; keys: string[] }[] = [
  { label: 'Substance', keys: ['substance', 'Substance'] },
  { label: 'Diameter', keys: ['diameter', 'Diameter'] },
  { label: 'Capacity', keys: ['capacity', 'Capacity', 'capacity_text'] },
  { label: 'Status', keys: ['status', 'Status'] },
  { label: 'Owner', keys: ['owner', 'Owner'] },
  { label: 'Length (km)', keys: ['length_km', 'LengthMergedKm'] },
  { label: 'Voltage', keys: ['voltage', 'Voltage'] },
  { label: 'Reference', keys: ['ref', 'Ref', 'REF'] },
  { label: 'Network', keys: ['network', 'Network'] },
  { label: 'Location', keys: ['location', 'Location'] },
  { label: 'In service from', keys: ['start_date', 'Start_date'] },
  { label: 'Usage', keys: ['usage', 'Usage'] },
];

export function isOsmInfrastructureFeature(props: Record<string, unknown>): boolean {
  const source = firstString(props, ['source', 'Source', 'SOURCE']);
  if (source?.toLowerCase() === 'openstreetmap') return true;
  return props.osm_id != null || props.osm_type != null;
}

export function buildOsmObjectUrl(
  osmType: string | null | undefined,
  osmId: string | number | null | undefined
): string | null {
  if (!osmType || osmId == null) return null;
  const type = String(osmType).trim();
  const id = String(osmId).trim();
  if (!type || !id) return null;
  return `https://www.openstreetmap.org/${type}/${id}`;
}

/** Parse OSM wikipedia tag (e.g. en:Article) into a URL. */
export function parseOsmWikipediaUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const lang = trimmed.slice(0, colon).trim().toLowerCase();
    const article = trimmed.slice(colon + 1).trim().replace(/ /g, '_');
    if (lang && article) {
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article)}`;
    }
  }
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(trimmed.replace(/ /g, '_'))}`;
}

export function parseOsmWikidataUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const qid = trimmed.startsWith('Q') ? trimmed : `Q${trimmed}`;
  return `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`;
}

export function collectOsmPipelineDetails(
  props: Record<string, unknown>
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  const addRow = (label: string, value: string) => {
    const key = `${label}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ label, value });
  };

  for (const spec of OSM_PIPELINE_DETAIL_SPECS) {
    const value = firstString(props, spec.keys);
    if (value) addRow(spec.label, value);
  }

  for (const [key, raw] of Object.entries(props)) {
    if (!key.startsWith('diameter') || raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    const suffix = key.slice('diameter'.length).replace(/^:/, '').replace(/_/g, ' ').trim();
    const label = suffix ? `Diameter ${suffix.toLowerCase()}` : 'Diameter';
    addRow(label, value);
  }

  return rows;
}

/** GEM GOGPT / GOIT / extraction — counterparties useful for outreach (not tank lessors). */
export function collectGemCommercialDetails(
  props: Record<string, unknown>,
): { label: string; value: string }[] {
  const isGem =
    String(props.source || '').startsWith('gem_') ||
    props.layer_id === 'gem_plants' ||
    props.layer_id === 'gem_pipelines' ||
    props.counterparties != null;
  if (!isGem) return [];

  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = value?.trim();
    if (text) rows.push({ label, value: text });
  };

  add('Operator', firstString(props, ['operator', 'Operator(s)', 'Operator']));
  add('Owner', firstString(props, ['owner', 'Owner(s)', 'Owner']));
  add('Parent', firstString(props, ['Parent(s)', 'parent']));
  add('Primary contact (GEM)', firstString(props, ['primary_counterparty']));
  add('Captive industry', firstString(props, ['captive_industry_use', 'captive_industry_type']));
  add('Equipment', firstString(props, ['equipment', 'Equipment Manufacturer/Model']));
  add('Location accuracy', firstString(props, ['location_accuracy', 'Location accuracy']));
  add('GEM entity (owner)', firstString(props, ['owner_gem_entity_id']));
  add('Note', firstString(props, ['commercial_note']));

  const parties = props.counterparties;
  if (Array.isArray(parties)) {
    for (const block of parties) {
      if (!block || typeof block !== 'object') continue;
      const role = String((block as Record<string, unknown>).role || '').trim();
      const names = (block as Record<string, unknown>).names;
      if (!role || !Array.isArray(names) || names.length === 0) continue;
      const label = role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      add(label, names.map(String).join('; '));
    }
  }

  return rows;
}

export function petroleumLayerTypeLabel(layerId: PetroleumLayerId): string {
  return LAYER_TYPE_LABEL[layerId] ?? 'Infrastructure';
}

/** Popup badge for pipelines: substance from OSM tags, not the map layer id alone. */
export function resolvePipelineBadgeLabel(
  props: Record<string, unknown>,
  layerId: PetroleumLayerId
): string {
  const substance = classifyPipelineSubstance(props);
  const isOsmPipe =
    isOsmInfrastructureFeature(props) ||
    props.man_made === 'pipeline' ||
    props.layer_id === 'pipelines';
  if (isOsmPipe || substance === 'water' || substance === 'oil' || substance === 'gas') {
    return pipelineSubstanceDisplayLabel(substance);
  }
  if (PIPELINE_LAYER_IDS.has(layerId)) {
    return petroleumLayerTypeLabel(layerId);
  }
  return pipelineSubstanceDisplayLabel(substance);
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
  const isOsmFeature = isOsmInfrastructureFeature(props);
  const isPipelineLayer = PIPELINE_LAYER_IDS.has(layerId);
  const isOsmPipeline =
    isOsmFeature &&
    (isPipelineLayer ||
      props.man_made === 'pipeline' ||
      props.layer_id === 'pipelines');
  const pipelineSubstance = isOsmPipeline ? classifyPipelineSubstance(props) : null;
  const pipelineBadgeLabel = isOsmPipeline
    ? resolvePipelineBadgeLabel(props, layerId)
    : isPipelineLayer
      ? petroleumLayerTypeLabel(layerId)
      : null;
  const name = firstString(props, [
    'Name',
    'NAME',
    'name',
    'title',
    'Title',
    'plant_name',
    'unit_name',
  ]);
  const owner = firstString(props, ['owner', 'Owner', 'OWNER', 'Owner(s)']);
  const exploringCompanies = collectExploringCompanies(props);
  const operatorFromTags =
    firstString(props, ['operator', 'Operator', 'OPERATOR']) ??
    (exploringCompanies.length === 1 ? exploringCompanies[0] : null);
  const operator = operatorFromTags ?? owner ?? null;
  const countryRaw = firstString(props, ['Country', 'COUNTRY', 'country', 'Nation', 'country']);
  const country = resolvePetroleumCountry(countryRaw);
  const facilityType =
    (isOsmPipeline && pipelineSubstance
      ? pipelineSubstanceDisplayLabel(pipelineSubstance)
      : null) ??
    firstString(props, ['Type', 'TYPE', 'type', 'category', 'Category']) ??
    (isOsmFeature && props.man_made
      ? `OSM ${String(props.man_made).replace(/_/g, ' ')}`
      : null) ??
    (isPipelineLayer ? petroleumLayerTypeLabel(layerId) : null);
  const status = firstString(props, ['STATUS', 'Status', 'status', 'State']);
  const sector =
    firstString(props, ['Sector', 'sector', 'Commodity', 'commodity']) ??
    (isPipelineLayer ? firstString(props, ['substance', 'Substance']) : null);
  const capacity = firstString(props, [
    'Capacity',
    'capacity',
    'capacity_text',
    'CAPACITY',
    'bpd',
    'BPD',
    'throughput',
  ]);
  const description = firstString(props, ['description', 'Description', 'notes', 'Notes']);
  const sourceRaw = firstString(props, [
    'Source',
    'SOURCE',
    'source',
    'link',
    'Link',
    'URL',
    'url',
    'wiki_url',
    'Wiki URL',
  ]);
  let { sourceUrl, sourceLabel, sourceText } = parsePetroleumSource(sourceRaw);

  const osmUrl = buildOsmObjectUrl(
    firstString(props, ['osm_type', 'Osm_type']),
    props.osm_id as string | number | undefined
  );
  const wikipediaUrl = parseOsmWikipediaUrl(firstString(props, ['wikipedia', 'Wikipedia']));
  const wikidataUrl = parseOsmWikidataUrl(firstString(props, ['wikidata', 'Wikidata']));

  if (!sourceUrl && osmUrl) {
    sourceUrl = osmUrl;
    sourceLabel = 'OpenStreetMap';
    sourceText = null;
  }

  const pipelineDetails = isOsmPipeline ? collectOsmPipelineDetails(props) : [];
  const gemCommercial = collectGemCommercialDetails(props);

  const operatorMissing =
    isOsmPipeline && !operator && !owner && exploringCompanies.length === 0;

  const extraRows: { label: string; value: string }[] = [...gemCommercial];
  const gemConsumed = new Set(
    gemCommercial.map((r) => r.label.toLowerCase()).concat([
      'counterparties',
      'operators',
      'owners',
      'parents',
      'commercial_note',
      'source_id',
      'source_name',
      'source_url',
      'data_tier',
      'attribution',
      'unit_key',
      'gem_unit_id',
      'gem_location_id',
      'layer_id',
      'project_id',
      'segment_key',
    ]),
  );
  for (const [key, raw] of Object.entries(props)) {
    if (CONSUMED_PROPERTY_KEYS.has(key) || raw == null) continue;
    if (gemConsumed.has(key.toLowerCase()) || gemConsumed.has(humanizeKey(key).toLowerCase())) {
      continue;
    }
    const value = String(raw).trim();
    if (!value) continue;
    if (key === 'counterparties' || typeof raw === 'object') continue;
    if (isOsmPipeline) {
      const lower = key.toLowerCase();
      if (
        lower === 'source' ||
        lower === 'osm_id' ||
        lower === 'osm_type' ||
        lower === 'layer_id' ||
        lower === 'attribution' ||
        lower === 'persisted' ||
        lower.startsWith('diameter')
      ) {
        continue;
      }
    }
    extraRows.push({ label: humanizeKey(key), value });
  }
  extraRows.sort((a, b) => a.label.localeCompare(b.label));

  const title =
    name ??
    operator ??
    (exploringCompanies[0] ?? null) ??
    (isOsmPipeline && props.osm_id != null ? `OSM pipeline ${props.osm_id}` : null) ??
    facilityType ??
    'Unnamed feature';

  const subtitle =
    country && title !== country
      ? country
      : isOsmFeature && props.osm_id
        ? `OSM way ${props.osm_id}`
        : null;

  return {
    title,
    subtitle,
    facilityType,
    pipelineSubstance,
    pipelineBadgeLabel,
    operator: operator ?? (exploringCompanies.length === 1 ? exploringCompanies[0] : null),
    owner,
    operatorMissing,
    exploringCompanies,
    country,
    status,
    sector,
    capacity,
    source: isOsmFeature ? 'OpenStreetMap (community)' : sourceText,
    sourceUrl,
    sourceLabel,
    description,
    osmUrl,
    wikipediaUrl,
    wikidataUrl,
    isOsmFeature,
    pipelineDetails,
    extraRows: extraRows.slice(0, gemCommercial.length > 0 ? 10 : isOsmPipeline ? 2 : 4),
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
