import { describe, expect, it } from 'vitest';
import { resolveLiveDataVesselStatus } from './liveDataVesselStatus';

describe('resolveLiveDataVesselStatus', () => {
  it('shows in-view count and API cap for oil-live vessels', () => {
    const status = resolveLiveDataVesselStatus({ vesselsInView: 12 });
    expect(status.headlineEn).toContain('12');
    expect(status.headlineEn).toContain('500');
  });

  it('warns on Persian Gulf sparse coverage', () => {
    const status = resolveLiveDataVesselStatus({
      vesselsInView: 0,
      syncStatus: { live_vessel_count: 0 } as never,
      inPersianGulfViewport: true,
    });
    expect(status.detailEn).toMatch(/Persian Gulf/i);
    expect(status.detailEn).toMatch(/demo seeds are off/i);
  });

  it('shows cap message when vessel_meta reports cap_applied', () => {
    const status = resolveLiveDataVesselStatus({
      vesselsInView: 500,
      vesselMeta: { total_available: 820, returned_count: 500, cap_applied: true, limit: 500 },
    });
    expect(status.detailEn).toContain('820');
    expect(status.detailEn).toContain('tankers prioritized');
  });

  it('delegates to maritime messages when all-maritime is enabled', () => {
    const status = resolveLiveDataVesselStatus({
      vesselsInView: 3,
      allMaritimeEnabled: true,
      maritimeMessages: {
        headlineEn: '3 in view · 22k in feed',
        headlineHe: '3 בתצוגה',
        detailEn: 'detail',
        detailHe: 'פרט',
        sparseWarningEn: 'Sparse upstream',
        sparseWarningHe: 'דליל',
      },
    });
    expect(status.headlineEn).toBe('3 in view · 22k in feed');
    expect(status.detailEn).toBe('Sparse upstream');
  });
});
