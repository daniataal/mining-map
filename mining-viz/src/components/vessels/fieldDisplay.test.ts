import { describe, expect, it } from 'vitest';
import { buildVesselFieldGroups } from './fieldDisplay';
import type { MaritimeVessel } from '../../lib/vessels/types';

const baseVessel = (over: Partial<MaritimeVessel>): MaritimeVessel => ({
  id: 'mmsi:123',
  mmsi: '123',
  vessel_name: 'Test Vessel',
  lat: 25,
  lng: 52,
  observed_at: '2026-01-01T12:00:00Z',
  source_label: 'AIS',
  ...over,
});

describe('buildVesselFieldGroups', () => {
  it('formats observed_at and avoids Invalid Date for missing timestamps', () => {
    const withTimestamp = buildVesselFieldGroups(baseVessel({}));
    const positionRows = withTimestamp.find((group) => group.title === 'Position')?.rows ?? [];
    const observed = positionRows.find((row) => row.key === 'observed_at');
    expect(observed?.value).not.toBe('Invalid Date');
    expect(observed?.value).not.toBe('—');

    const withoutTimestamp = buildVesselFieldGroups(baseVessel({ observed_at: '' }));
    const missingObserved = (withoutTimestamp.find((group) => group.title === 'Position')?.rows ?? [])
      .find((row) => row.key === 'observed_at');
    expect(missingObserved?.value).toBe('—');
  });
});
