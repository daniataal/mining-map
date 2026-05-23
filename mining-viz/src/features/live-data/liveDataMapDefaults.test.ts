import { describe, expect, it } from 'vitest';
import {
  LIVE_DATA_DEFAULT_LAYERS,
  LIVE_DATA_OIL_GAS_TAB_LAYERS,
  LIVE_DATA_VESSEL_FILTERS,
  GOVERNMENT_AIS_COVERAGE_SOURCES,
  viewportOverlapsPersianGulfHub,
} from './liveDataMapDefaults';

describe('liveDataMapDefaults', () => {
  it('keeps vessels off by default on Live Data entry', () => {
    expect(LIVE_DATA_DEFAULT_LAYERS.vessels).toBe(false);
    expect(LIVE_DATA_DEFAULT_LAYERS.terminals).toBe(true);
  });

  it('enables vessels on Oil & Gas Live tab entry (MAD-74)', () => {
    expect(LIVE_DATA_OIL_GAS_TAB_LAYERS.vessels).toBe(true);
    expect(LIVE_DATA_OIL_GAS_TAB_LAYERS.terminals).toBe(true);
  });

  it('defaults all-maritime ship filters to tankers and cargo', () => {
    expect(LIVE_DATA_VESSEL_FILTERS.shipTypes).toEqual(['Tanker', 'Cargo']);
  });

  it('detects Persian Gulf hub overlap', () => {
    expect(
      viewportOverlapsPersianGulfHub({ south: 20, west: 40, north: 30, east: 50 }),
    ).toBe(true);
    expect(
      viewportOverlapsPersianGulfHub({ south: -10, west: -20, north: 0, east: 10 }),
    ).toBe(false);
  });

  it('exports government AIS coverage source ids for BarentsWatch filter', () => {
    expect(GOVERNMENT_AIS_COVERAGE_SOURCES).toContain('barentswatch');
  });
});
