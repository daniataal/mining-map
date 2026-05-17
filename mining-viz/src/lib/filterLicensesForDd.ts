import {
  getLicenseCommodityLabels,
  licenseMatchesSelectedCommodities,
} from './commodities';
import { buildLicenseSearchIndex, licenseHaystackMatches } from './licenseSearchIndex';
import { MiningLicense, UserAnnotation } from '../types';

export type DdListMode = 'queue' | 'browse';

export interface DdFilterState {
  search: string;
  countries: string[];
  commodities: string[];
  sectors: string[];
  statuses: string[];
  stages: string[];
  dateFrom: string;
  dateTo: string;
  addedOnly: boolean;
}

export const EMPTY_DD_FILTERS: DdFilterState = {
  search: '',
  countries: [],
  commodities: [],
  sectors: [],
  statuses: [],
  stages: [],
  dateFrom: '',
  dateTo: '',
  addedOnly: false,
};

function parseLicenseDate(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function sectorLabel(item: MiningLicense): string {
  const raw = (item.sector || 'mining').trim().toLowerCase();
  if (raw === 'oil_and_gas' || raw === 'oil-gas' || raw === 'oil gas') return 'oil_and_gas';
  return 'mining';
}

export function applyDdFilters(
  items: MiningLicense[],
  filters: DdFilterState,
  userAnnotations: Record<string, UserAnnotation>,
  queueIds: Set<string>,
): MiningLicense[] {
  let data = items;

  if (filters.addedOnly) {
    data = data.filter((item) => queueIds.has(item.id));
  }

  if (filters.countries.length > 0) {
    data = data.filter((item) => {
      const country = item.country?.trim();
      return country ? filters.countries.includes(country) : false;
    });
  }

  if (filters.commodities.length > 0) {
    data = data.filter((item) => {
      const annotation = userAnnotations[item.id] || {};
      const labels = getLicenseCommodityLabels(item.commodity, annotation.commodity);
      return licenseMatchesSelectedCommodities(labels, filters.commodities);
    });
  }

  if (filters.sectors.length > 0) {
    data = data.filter((item) => filters.sectors.includes(sectorLabel(item)));
  }

  if (filters.statuses.length > 0) {
    data = data.filter((item) => {
      const status = (item.status || 'Unknown').trim();
      return filters.statuses.includes(status);
    });
  }

  if (filters.stages.length > 0) {
    data = data.filter((item) => {
      const stage = (userAnnotations[item.id]?.stage as string) || 'New';
      return filters.stages.includes(stage);
    });
  }

  if (filters.dateFrom || filters.dateTo) {
    const fromTs = filters.dateFrom ? parseLicenseDate(filters.dateFrom) : null;
    const toTs = filters.dateTo ? parseLicenseDate(filters.dateTo) : null;
    data = data.filter((item) => {
      const itemTs = parseLicenseDate(item.date);
      if (itemTs === null) return false;
      if (fromTs !== null && itemTs < fromTs) return false;
      if (toTs !== null && itemTs > toTs) return false;
      return true;
    });
  }

  if (filters.search.trim()) {
    const lower = filters.search.trim().toLowerCase();
    const searchIndex = buildLicenseSearchIndex(data, userAnnotations);
    data = data.filter((item) => {
      if (licenseHaystackMatches(searchIndex, item.id, lower)) return true;
      const annotation = userAnnotations[item.id] || {};
      const note = (annotation.notes || annotation.comment || '').toLowerCase();
      return (
        item.region?.toLowerCase().includes(lower) ||
        item.id.toLowerCase().includes(lower) ||
        note.includes(lower)
      );
    });
  }

  return data;
}

export function buildDdFacetOptions(items: MiningLicense[], userAnnotations: Record<string, UserAnnotation>) {
  const countries = new Set<string>();
  const commodities = new Set<string>();
  const statuses = new Set<string>();
  const stages = new Set<string>();

  for (const item of items) {
    if (item.country?.trim()) countries.add(item.country.trim());
    const annotation = userAnnotations[item.id] || {};
    for (const label of getLicenseCommodityLabels(item.commodity, annotation.commodity)) {
      commodities.add(label);
    }
    statuses.add((item.status || 'Unknown').trim());
    stages.add((annotation.stage as string) || 'New');
  }

  return {
    countries: Array.from(countries).sort(),
    commodities: Array.from(commodities).sort(),
    statuses: Array.from(statuses).sort(),
    stages: Array.from(stages).sort(),
    sectors: ['mining', 'oil_and_gas'] as const,
  };
}
