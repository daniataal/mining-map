import { describe, expect, it } from 'vitest';
import { summarizeVesselTrack, trackPointsToPath } from './vesselTrack';

describe('trackPointsToPath', () => {
  it('drops invalid and duplicate coordinates', () => {
    const path = trackPointsToPath([
      { latitude: 25.1, longitude: 55.2, received_at: '2026-05-30T10:00:00Z' },
      { latitude: 25.1, longitude: 55.2, received_at: '2026-05-30T10:05:00Z' },
      { latitude: 999, longitude: 55.2 },
      { latitude: 25.2, longitude: 55.3, received_at: '2026-05-30T11:00:00Z' },
    ]);
    expect(path).toEqual([
      [25.1, 55.2],
      [25.2, 55.3],
    ]);
  });

  it('returns empty for missing points', () => {
    expect(trackPointsToPath(undefined)).toEqual([]);
  });
});

describe('summarizeVesselTrack', () => {
  it('counts valid points and time span', () => {
    const summary = summarizeVesselTrack([
      { latitude: 1, longitude: 2, received_at: '2026-05-30T08:00:00Z' },
      { latitude: 1.1, longitude: 2.1, received_at: '2026-05-30T12:00:00Z' },
    ]);
    expect(summary.pointCount).toBe(2);
    expect(summary.fromLabel).toBeTruthy();
    expect(summary.toLabel).toBeTruthy();
  });
});
