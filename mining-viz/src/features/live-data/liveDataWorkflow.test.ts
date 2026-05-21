import { describe, expect, it } from 'vitest';
import {
  commodityMatchesFilter,
  isOnWatchlist,
  opportunityWatchTarget,
  terminalMatchesSearch,
} from './liveDataWorkflow';
import type { OilOpportunity, OilWatchlistItem } from '../../api/oilLiveApi';

describe('liveDataWorkflow', () => {
  it('terminalMatchesSearch matches name and country', () => {
    expect(
      terminalMatchesSearch({ id: '1', name: 'Ras Tanura', country: 'Saudi Arabia' }, 'ras'),
    ).toBe(true);
    expect(
      terminalMatchesSearch({ id: '1', name: 'Ras Tanura', country: 'Saudi Arabia' }, 'netherlands'),
    ).toBe(false);
    expect(terminalMatchesSearch({ id: '1', name: 'Foo' }, '')).toBe(true);
  });

  it('commodityMatchesFilter respects all vs family', () => {
    expect(commodityMatchesFilter('crude', 'all')).toBe(true);
    expect(commodityMatchesFilter('crude', 'crude')).toBe(true);
    expect(commodityMatchesFilter('refined', 'crude')).toBe(false);
  });

  it('opportunityWatchTarget prefers terminal', () => {
    const opp: OilOpportunity = {
      id: 'o1',
      opportunity_type: 'storage_arbitrage',
      terminal_id: 't1',
    };
    expect(opportunityWatchTarget(opp)).toEqual({ watch_type: 'terminal', watch_ref: 't1' });
  });

  it('isOnWatchlist detects existing row', () => {
    const watches: OilWatchlistItem[] = [
      {
        id: 'w1',
        user_id: 'u',
        watch_type: 'terminal',
        watch_ref: 't1',
        min_confidence: 0.55,
      },
    ];
    expect(isOnWatchlist(watches, 'terminal', 't1')).toBe(true);
    expect(isOnWatchlist(watches, 'terminal', 't2')).toBe(false);
  });
});
