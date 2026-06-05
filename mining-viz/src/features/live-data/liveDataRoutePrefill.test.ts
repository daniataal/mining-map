import { describe, expect, it } from 'vitest';
import {
  buildRoutePlannerHintsFromOpportunity,
  buildRoutePlannerHintsFromCargo,
  matchPortPreset,
  resolveRoutePartyFromPort,
} from './liveDataRoutePrefill';
import type { MeridianCargoRecord, OilOpportunity } from '../../api/oilLiveApi';

describe('liveDataRoutePrefill', () => {
  it('matchPortPreset resolves Rotterdam from MCR-style name', () => {
    const preset = matchPortPreset('Rotterdam', 'Netherlands');
    expect(preset?.name).toMatch(/Rotterdam/i);
    expect(preset?.lat).toBeCloseTo(51.92, 1);
  });

  it('matchPortPreset resolves Ras Tanura style names via catalog', () => {
    const preset = matchPortPreset('Jebel Ali', 'United Arab Emirates');
    expect(preset?.country).toMatch(/Emirates/i);
  });

  it('buildRoutePlannerHintsFromCargo maps load and discharge fields', () => {
    const record: MeridianCargoRecord = {
      id: 'c1',
      load_port_name: 'Port of Houston',
      load_country: 'United States',
      discharge_hint: 'Rotterdam',
      discharge_country: 'Netherlands',
      corridor_load_lat: 29.7,
      corridor_load_lng: -95.2,
      commodity_family: 'crude',
    };
    const hints = buildRoutePlannerHintsFromCargo(record);
    expect(hints.load_port_name).toBe('Port of Houston');
    expect(hints.discharge_port_name).toBe('Rotterdam');
    expect(hints.commodity_family).toBe('crude');
  });

  it('buildRoutePlannerHintsFromOpportunity prefers Deal Radar route prefill', () => {
    const opp: OilOpportunity = {
      id: 'opp-1',
      opportunity_type: 'supplier_buyer_route_candidate',
      terminal_name: 'Fallback Terminal',
      terminal_country: 'Fallback Country',
      route_prefill: {
        load_port_name: 'Tema',
        load_country: 'Ghana',
        discharge_port_name: 'Rotterdam',
        discharge_country: 'Netherlands',
        commodity_family: 'diesel',
      },
    };
    const hints = buildRoutePlannerHintsFromOpportunity(opp);
    expect(hints.load_port_name).toBe('Tema');
    expect(hints.discharge_port_name).toBe('Rotterdam');
    expect(hints.commodity_family).toBe('diesel');
    expect(hints.opportunity_id).toBe('opp-1');
  });

  it('resolveRoutePartyFromPort falls back to country hub when port and coords are missing', () => {
    const party = resolveRoutePartyFromPort(undefined, 'United States', {});
    expect(party).not.toBeNull();
    expect(party?.country).toMatch(/United States|USA/i);
    expect(typeof party?.lat).toBe('number');
    expect(typeof party?.lng).toBe('number');
  });
});
