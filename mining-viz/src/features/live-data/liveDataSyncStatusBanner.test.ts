import { describe, expect, it } from 'vitest';
import {
  buildLiveDataSyncTierLines,
  fmtLedgerCount,
  liveDataSyncBannerMessage,
  resolveLiveDataSyncBannerKind,
} from './liveDataSyncStatusBanner';
import type { OilLiveSyncStatus } from '../../api/oilLiveApi';

describe('liveDataSyncStatusBanner', () => {
  it('fmtLedgerCount formats integers and handles null', () => {
    expect(fmtLedgerCount(1200)).toBe('1,200');
    expect(fmtLedgerCount(null)).toBe('—');
  });

  it('resolveLiveDataSyncBannerKind flags demo_only when only seed rows', () => {
    const sync: OilLiveSyncStatus = {
      terminal_count: 0,
      cargo_record_count: 0,
      port_call_count: 0,
      demo_port_call_count: 12,
      demo_cargo_record_count: 0,
      production_cargo_record_count: 0,
      live_vessel_count: 0,
    };
    expect(resolveLiveDataSyncBannerKind(sync, { unreachable: false, pending: false })).toBe(
      'demo_only',
    );
  });

  it('resolveLiveDataSyncBannerKind returns ok with live AIS and terminals', () => {
    const sync: OilLiveSyncStatus = {
      terminal_count: 40,
      cargo_record_count: 100,
      port_call_count: 50,
      production_cargo_record_count: 95,
      live_vessel_count: 12,
      live_ais_port_call_count: 8,
      last_graph_sync_at: new Date().toISOString(),
    };
    expect(resolveLiveDataSyncBannerKind(sync, { unreachable: false, pending: false })).toBe('ok');
  });

  it('buildLiveDataSyncTierLines includes live AIS and infrastructure', () => {
    const lines = buildLiveDataSyncTierLines({
      terminal_count: 10,
      cargo_record_count: 5,
      port_call_count: 3,
      live_vessel_count: 7,
      last_vessel_observation_at: '2026-05-23T12:00:00Z',
      last_graph_sync_at: '2026-05-22T08:00:00Z',
    });
    const keys = lines.map((l) => l.key);
    expect(keys).toContain('live_ais');
    expect(keys).toContain('infrastructure');
    const live = lines.find((l) => l.key === 'live_ais');
    expect(live?.count).toBe(7);
  });

  it('liveDataSyncBannerMessage returns unreachable copy', () => {
    const msg = liveDataSyncBannerMessage('unreachable');
    expect(msg?.en).toMatch(/sync-status/i);
  });
});
