import { describe, expect, it } from 'vitest';
import { normalizeMaritimeVessel, normalizeMaritimeVessels } from './normalize';
import type { MaritimeVessel } from './types';

describe('normalizeMaritimeVessel', () => {
  it('maps Go live feed fields to the frontend vessel contract', () => {
    const raw = {
      mmsi: 760003640,
      name: 'E/F RODRIGO XX',
      ts: '2026-05-30T13:29:56.034991Z',
      lat: -3.29837,
      lng: -60.16724,
      speed: 0,
      course: 112.5,
      source: 'live_ais',
    } as unknown as MaritimeVessel;

    const vessel = normalizeMaritimeVessel(raw);

    expect(vessel.id).toBe('mmsi:760003640');
    expect(vessel.mmsi).toBe('760003640');
    expect(vessel.vessel_name).toBe('E/F RODRIGO XX');
    expect(vessel.observed_at).toBe('2026-05-30T13:29:56.034991Z');
    expect(vessel.speed_knots).toBe(0);
    expect(vessel.course_over_ground).toBe(112.5);
    expect(vessel.source_label).toBe('live_ais');
  });

  it('assigns unique ids so canvas hit-testing can resolve each vessel', () => {
    const vessels = normalizeMaritimeVessels([
      { mmsi: 667001584, name: 'GARUDA', ts: '2026-05-31T07:47:46Z', lat: -3.14, lng: -59.92, source: 'live_ais' } as unknown as MaritimeVessel,
      { mmsi: 710251000, name: 'JOSE AIUB', ts: '2026-05-30T13:05:36Z', lat: -3.16, lng: -59.94, source: 'live_ais' } as unknown as MaritimeVessel,
      { mmsi: 760003640, name: 'E/F RODRIGO XX', ts: '2026-05-30T13:29:56Z', lat: -3.29, lng: -60.16, source: 'live_ais' } as unknown as MaritimeVessel,
    ]);

    const ids = new Set(vessels.map((vessel) => vessel.id));
    expect(ids.size).toBe(3);
    expect(vessels.map((vessel) => vessel.mmsi)).toEqual(['667001584', '710251000', '760003640']);
  });

  it('preserves explicit ids from legacy snapshots', () => {
    const vessel = normalizeMaritimeVessel({
      id: 'ais:123456789',
      mmsi: '123456789',
      vessel_name: 'Legacy Vessel',
      observed_at: '2026-01-01T00:00:00Z',
      lat: 1,
      lng: 2,
      source_label: 'AISStream',
    });

    expect(vessel.id).toBe('ais:123456789');
    expect(vessel.vessel_name).toBe('Legacy Vessel');
    expect(vessel.observed_at).toBe('2026-01-01T00:00:00Z');
  });
});
