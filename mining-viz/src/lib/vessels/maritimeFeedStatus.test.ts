import { describe, expect, it } from 'vitest';
import { buildMaritimeStatusMessages, resolveMaritimeFeedIssue } from './maritimeFeedStatus';
import type { MaritimeVesselFeedResponse } from './types';

function feed(partial: Partial<MaritimeVesselFeedResponse>): MaritimeVesselFeedResponse {
  return {
    vessels: [],
    source: 'test',
    data_as_of: '2026-01-01T00:00:00Z',
    live_positions_enabled: false,
    limitations: [],
    scope: 'all_vessels',
    capture_window_seconds: 10,
    max_vessels: 100,
    ...partial,
  };
}

describe('resolveMaritimeFeedIssue', () => {
  it('detects missing API key', () => {
    expect(
      resolveMaritimeFeedIssue(feed({ aisstream_configured: false }), {
        layerEnabled: true,
        vesselsInView: 0,
        snapshotTotal: 0,
      }),
    ).toBe('key_missing');
  });

  it('detects worker down when snapshot is sparse', () => {
    expect(
      resolveMaritimeFeedIssue(
        feed({ aisstream_configured: true, worker: { status: 'error' } }),
        { layerEnabled: true, vesselsInView: 0, snapshotTotal: 0 },
      ),
    ).toBe('worker_down');
  });

  it('detects viewport empty when live feed has vessels elsewhere', () => {
    expect(
      resolveMaritimeFeedIssue(feed({ live_positions_enabled: true, snapshot_vessel_count: 500 }), {
        layerEnabled: true,
        vesselsInView: 0,
        snapshotTotal: 500,
      }),
    ).toBe('viewport_empty');
  });
});

describe('buildMaritimeStatusMessages', () => {
  it('uses key-missing sparse warning copy', () => {
    const messages = buildMaritimeStatusMessages(
      feed({ aisstream_configured: false }),
      {
        layerEnabled: true,
        vesselsInView: 0,
        snapshotTotal: 0,
        isLoading: false,
        hasError: false,
      },
    );
    expect(messages?.sparseWarningEn).toContain('backend.env');
  });
});
