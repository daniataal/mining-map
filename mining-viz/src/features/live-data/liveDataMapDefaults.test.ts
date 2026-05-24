import { describe, expect, it } from 'vitest';
import {
  LIVE_DATA_DEFAULT_LAYERS,
  LIVE_DATA_LENS_LAYERS,
  layersForLiveDataLens,
  LIVE_DATA_OIL_GAS_TAB_LAYERS,
  LIVE_DATA_VESSEL_FILTERS,
  GOVERNMENT_AIS_COVERAGE_SOURCES,
  viewportOverlapsPersianGulfHub,
} from './liveDataMapDefaults';

describe('liveDataMapDefaults', () => {
  it('defaults Live Data to Deal Lens connector layers', () => {
    expect(LIVE_DATA_DEFAULT_LAYERS.vessels).toBe(true);
    expect(LIVE_DATA_DEFAULT_LAYERS.terminals).toBe(true);
    expect(LIVE_DATA_DEFAULT_LAYERS.coverage).toBe(false);
    expect(LIVE_DATA_DEFAULT_LAYERS.opportunities).toBe(true);
  });

  it('keeps Oil & Gas Live tab aligned with Deal Lens', () => {
    expect(LIVE_DATA_OIL_GAS_TAB_LAYERS.vessels).toBe(true);
    expect(LIVE_DATA_OIL_GAS_TAB_LAYERS.terminals).toBe(true);
  });

  it('keeps raw data lens as the analyst-heavy layer set', () => {
    expect(LIVE_DATA_LENS_LAYERS.raw.coverage).toBe(true);
    expect(LIVE_DATA_LENS_LAYERS.raw.corridors).toBe(true);
    expect(layersForLiveDataLens('deal')).not.toBe(LIVE_DATA_LENS_LAYERS.deal);
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
