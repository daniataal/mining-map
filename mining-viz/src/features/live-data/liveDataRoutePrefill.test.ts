import { describe, expect, it } from 'vitest';
import {
  buildRoutePlannerHintsFromCargo,
  matchPortPreset,
} from './liveDataRoutePrefill';
import type { MeridianCargoRecord } from '../../api/oilLiveApi';

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
});
