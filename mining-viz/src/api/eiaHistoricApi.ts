import { API_BASE } from '../lib/api';

export type EiaHistoricSummary = {
  year_min: number | null;
  year_max: number | null;
  row_count: number;
  importer_count: number;
  by_year: { year: number; volume_bbl: number; row_count: number }[];
  top_origins: { origin_country: string; volume_bbl: number; row_count: number }[];
  top_importers: { importer_name: string; volume_bbl: number }[];
  provenance?: string;
};

export type EiaHistoricSeriesPoint = {
  year: number;
  month: number | null;
  volume_bbl: number;
  row_count: number;
  period: string;
};

export type EiaHistoricMapArc = {
  origin_country: string;
  commodity_family: string;
  volume_bbl: number;
  row_count: number;
  destination_country: string;
};

export type EiaHistoricOriginImporter = {
  importer_name: string;
  volume_bbl: number;
  row_count: number;
};

export type EiaHistoricMapOrigin = {
  origin_country: string;
  volume_bbl: number;
  row_count: number;
  top_importers: EiaHistoricOriginImporter[];
  by_commodity: { commodity_family: string; volume_bbl: number; row_count: number }[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`EIA historic API ${res.status}`);
  return res.json() as Promise<T>;
}

export function getEiaHistoricSummary(params: {
  importer?: string;
  year_from?: number;
  year_to?: number;
}): Promise<EiaHistoricSummary> {
  const q = new URLSearchParams();
  if (params.importer) q.set('importer', params.importer);
  if (params.year_from != null) q.set('year_from', String(params.year_from));
  if (params.year_to != null) q.set('year_to', String(params.year_to));
  const qs = q.toString();
  return getJson(`/api/eia-historic-imports/summary${qs ? `?${qs}` : ''}`);
}

export function getEiaHistoricSeries(params: {
  importer: string;
  origin_country?: string;
  commodity_family?: string;
}): Promise<{ importer: string; points: EiaHistoricSeriesPoint[]; provenance?: string }> {
  const q = new URLSearchParams({ importer: params.importer });
  if (params.origin_country) q.set('origin_country', params.origin_country);
  if (params.commodity_family) q.set('commodity_family', params.commodity_family);
  return getJson(`/api/eia-historic-imports/series?${q}`);
}

export function getEiaHistoricMap(params: {
  year: number;
  importer?: string;
  limit?: number;
}): Promise<{
  year: number;
  arcs: EiaHistoricMapArc[];
  origins?: EiaHistoricMapOrigin[];
  provenance?: string;
}> {
  const q = new URLSearchParams({ year: String(params.year) });
  if (params.importer) q.set('importer', params.importer);
  if (params.limit != null) q.set('limit', String(params.limit));
  return getJson(`/api/eia-historic-imports/map?${q}`);
}
