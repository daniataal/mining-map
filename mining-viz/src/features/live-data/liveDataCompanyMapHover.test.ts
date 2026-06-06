import { describe, expect, it } from 'vitest';
import {
  companyMapEntityOpenPayload,
  companyMapHoverFromRecord,
  companyMapHoverUid,
} from './liveDataCompanyMapHover';

describe('liveDataCompanyMapHover', () => {
  it('builds hover payload when map coords exist', () => {
    expect(
      companyMapHoverFromRecord({
        id: 'c1',
        name: 'Vopak',
        map_lat: 51.95,
        map_lng: 4.05,
        map_terminal_id: 't1',
      }),
    ).toEqual({
      companyId: 'c1',
      name: 'Vopak',
      lat: 51.95,
      lng: 4.05,
      terminalId: 't1',
    });
  });

  it('returns null without map coords', () => {
    expect(companyMapHoverFromRecord({ id: 'c1', name: 'Unknown Co' })).toBeNull();
  });

  it('uses terminal uid when terminal id is known', () => {
    expect(
      companyMapHoverUid({
        companyId: 'c1',
        lat: 1,
        lng: 2,
        terminalId: 't1',
      }),
    ).toBe('terminal:t1');
  });

  it('falls back to company-hover uid for corridor-only locations', () => {
    expect(
      companyMapHoverUid({
        companyId: 'c1',
        lat: 1,
        lng: 2,
      }),
    ).toBe('company-hover:c1');
  });

  it('opens terminal drawer when map_terminal_id is present', () => {
    expect(
      companyMapEntityOpenPayload(
        {
          id: 'c1',
          name: 'Center Point Terminal Company',
          company_type: 'terminal_operator',
          country: 'United States',
          map_terminal_id: 't1',
        },
        { name: 'Houston Storage', operator_name: 'Center Point Terminal Company', country: 'United States' },
      ),
    ).toEqual({
      entityKind: 'terminal',
      entityId: 't1',
      title: 'Houston Storage',
      subtitle: 'Center Point Terminal Company · United States',
    });
  });

  it('opens company drawer when only corridor coords exist', () => {
    expect(
      companyMapEntityOpenPayload({
        id: 'c2',
        name: 'Trader Co',
        company_type: 'trader',
        country: 'Netherlands',
      }),
    ).toEqual({
      entityKind: 'company',
      entityId: 'c2',
      title: 'Trader Co',
      subtitle: 'trader · Netherlands',
    });
  });
});
