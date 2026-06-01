import { describe, expect, it } from 'vitest';
import {
  EIA_HISTORIC_BOL_TIER,
  enrichHistoricArc,
  historicArcRouteLabels,
} from './eiaHistoricLayer';
import type { EiaHistoricMapArc } from '../api/eiaHistoricApi';

const sampleArc: EiaHistoricMapArc = {
  origin_country: 'Saudi Arabia',
  commodity_family: 'crude',
  volume_bbl: 1_200_000,
  row_count: 12,
  destination_country: 'United States',
  port_city: 'Houston',
  port_state: 'TX',
  port_label: 'Houston, TX',
};

describe('eiaHistoricLayer', () => {
  it('tags arcs with historic bol_tier', () => {
    const enriched = enrichHistoricArc(sampleArc, 2020);
    expect(enriched.bol_tier).toBe(EIA_HISTORIC_BOL_TIER);
    expect(enriched.period).toBe('2020');
    expect(enriched.confidence).toContain('high');
  });

  it('builds origin and discharge labels', () => {
    const labels = historicArcRouteLabels(sampleArc);
    expect(labels.originLabel).toBe('Saudi Arabia');
    expect(labels.dischargeLabel).toBe('Houston, TX');
  });
});
