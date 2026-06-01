import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMaritimeSnapshotCache, writeMaritimeSnapshotCache } from './maritimeSnapshotCache';
import { resolveFleetVesselSelection } from './resolveFleetVessel';

describe('resolveFleetVesselSelection', () => {
  beforeEach(() => {
    clearMaritimeSnapshotCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearMaritimeSnapshotCache();
    vi.unstubAllGlobals();
  });

  it('returns vessel from live snapshot by IMO', async () => {
    writeMaritimeSnapshotCache({
      vessels: [
        {
          id: 'mmsi:123456789',
          mmsi: '123456789',
          imo: '9876543',
          vessel_name: 'MT TEST',
          lat: 12.3,
          lng: 45.6,
          observed_at: '2026-01-01T00:00:00Z',
          source_label: 'AIS',
        },
      ],
    });

    const resolved = await resolveFleetVesselSelection({
      imo: '9876543',
      name: 'MT TEST',
    });

    expect(resolved?.mmsi).toBe('123456789');
    expect(resolved?.vessel_name).toBe('MT TEST');
  });

  it('falls back to IMO lookup when not in snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/vessels/lookup?imo=9411234')) {
          return {
            ok: true,
            json: async () => ({
              mmsi: 636019825,
              imo: '9411234',
              name: 'MT SAKHALIN ISLAND',
              lat: 25.1,
              lng: 55.2,
              position_time: '2026-05-01T12:00:00Z',
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );

    const resolved = await resolveFleetVesselSelection({
      imo: '9411234',
      name: 'MT SAKHALIN ISLAND',
    });

    expect(resolved?.mmsi).toBe('636019825');
    expect(resolved?.source_label).toBe('ShipVault fleet');
    expect(resolved?.lat).toBe(25.1);
  });

  it('returns ShipVault stub when lookup fails but IMO is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })),
    );

    const resolved = await resolveFleetVesselSelection({
      imo: '9411234',
      name: 'MT SAKHALIN ISLAND',
      shipvault_vessel_id: 'sv-123',
    });

    expect(resolved?.id).toBe('imo:9411234');
    expect(resolved?.imo).toBe('9411234');
    expect(resolved?.vessel_name).toBe('MT SAKHALIN ISLAND');
    expect(resolved?.source_label).toBe('ShipVault fleet');
  });

  it('returns null when no identifiers are provided', async () => {
    const resolved = await resolveFleetVesselSelection({ name: 'Unknown' });
    expect(resolved).toBeNull();
  });
});
