import type { EiaHistoricMapArc } from '../api/eiaHistoricApi';

/** Honest tier for EIA impa file imports — not customs BOL. */
export const EIA_HISTORIC_BOL_TIER = 'historic' as const;

export const EIA_HISTORIC_SOURCE_LABEL = 'EIA Petroleum Supply Monthly (impa files)';

export const EIA_HISTORIC_SOURCE_URL =
  'https://www.eia.gov/petroleum/imports/companylevel/';

export const EIA_HISTORIC_DISCLAIMER_EN =
  'Historic company-level U.S. imports from EIA files — not live AIS, not customs bill of lading.';

export const EIA_HISTORIC_DISCLAIMER_HE =
  'יבוא היסטורי ברמת חברה מקבצי EIA — לא AIS חי ולא תעודת מטען מכס.';

/** Macro tier label when showing country-pair context (never on EIA arcs). */
export const MACRO_BOL_TIER = 'macro' as const;

export type EnrichedHistoricArc = EiaHistoricMapArc & {
  bol_tier: typeof EIA_HISTORIC_BOL_TIER;
  confidence: string;
  source: string;
  source_record_url: string;
  period: string;
};

export function enrichHistoricArc(arc: EiaHistoricMapArc, year: number): EnrichedHistoricArc {
  const rows = arc.row_count ?? 0;
  const confidence =
    rows >= 10 ? 'high (aggregated file rows)' : rows >= 3 ? 'medium (aggregated file rows)' : 'low (sparse rows)';
  return {
    ...arc,
    bol_tier: EIA_HISTORIC_BOL_TIER,
    confidence,
    source: EIA_HISTORIC_SOURCE_LABEL,
    source_record_url: EIA_HISTORIC_SOURCE_URL,
    period: String(year),
  };
}

export function historicArcRouteLabels(arc: EiaHistoricMapArc): {
  originLabel: string;
  dischargeLabel: string;
} {
  const originLabel = arc.origin_country || '—';
  const dischargeLabel =
    arc.port_label?.trim() ||
    [arc.port_city, arc.port_state].filter(Boolean).join(', ') ||
    arc.destination_country ||
    'United States';
  return { originLabel, dischargeLabel };
}
