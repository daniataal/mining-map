import type { PetroleumLayerId } from './petroleumLayers';

export interface PetroleumFeatureViewModel {
  title: string | null;
  subtitle: string | null;
  facilityType: string | null;
  operator: string | null;
  country: string | null;
  status: string | null;
  sector: string | null;
  capacity: string | null;
  source: string | null;
  sourceUrl: string | null;
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

/** Normalize heterogeneous oilmap tile properties into a stable popup view model. */
export function buildPetroleumFeatureViewModel(
  props: Record<string, unknown>,
  layerId: PetroleumLayerId
): PetroleumFeatureViewModel {
  const name = firstString(props, ['Name', 'NAME', 'name', 'title', 'Title']);
  const company = firstString(props, ['Company', 'company', 'OPERATOR', 'Operator', 'operator']);
  const country = firstString(props, ['Country', 'COUNTRY', 'country', 'Nation']);
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
  const sourceUrl = sourceRaw && isUrl(sourceRaw) ? sourceRaw : null;
  const source = sourceUrl ? null : sourceRaw;

  const consumed = new Set([
    'Name',
    'NAME',
    'name',
    'title',
    'Title',
    'Company',
    'company',
    'OPERATOR',
    'Operator',
    'operator',
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
  ]);

  const extraRows: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (consumed.has(key) || raw == null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    extraRows.push({ label: humanizeKey(key), value });
  }
  extraRows.sort((a, b) => a.label.localeCompare(b.label));

  const title = name ?? company ?? facilityType ?? 'Unnamed feature';
  const subtitle =
    name && company && company !== name
      ? company
      : country && name !== country
        ? country
        : null;

  return {
    title,
    subtitle,
    facilityType,
    operator: company && company !== title ? company : null,
    country,
    status,
    sector,
    capacity,
    source,
    sourceUrl,
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
