import { describe, it, expect } from 'vitest';
import {
  buildTradeEvidenceLinks,
  hsCodesFromCommodity,
  summarizeTradePartners,
  tradeEvidenceHasData,
} from './tradeEvidenceLinks';

describe('tradeEvidenceLinks', () => {
  it('builds Comtrade, Census, and ITC links with country and HS hints', () => {
    const links = buildTradeEvidenceLinks({
      country: 'Ghana',
      commodity: 'Gold',
      hsCodes: ['261690'],
    });
    expect(links).toHaveLength(3);
    expect(links[0].id).toBe('comtrade');
    expect(links[0].url).toContain('Reporters=Ghana');
    expect(links[0].url).toContain('261690');
    expect(links[1].id).toBe('census');
    expect(links[1].url).toContain('census.gov');
    expect(links[2].id).toBe('itc-trademap');
    expect(links[2].url).toContain('trademap.org');
  });

  it('infers HS codes from commodity label', () => {
    expect(hsCodesFromCommodity('Crude petroleum')).toContain('2709');
    expect(hsCodesFromCommodity('Gold ore')).toContain('261690');
  });

  it('aggregates import and export partners by USD', () => {
    const { imports, exports } = summarizeTradePartners([
      { partner: 'China', flow_type: 'M', trade_value_usd: 100, hs_code: '2603', year: 2022 },
      { partner: 'China', flow_type: 'M', trade_value_usd: 50, hs_code: '2603', year: 2023 },
      { partner: 'USA', flow_type: 'X', trade_value_usd: 200, hs_code: '2603', year: 2023 },
    ]);
    expect(imports).toHaveLength(1);
    expect(imports[0].partner).toBe('China');
    expect(imports[0].totalUsd).toBe(150);
    expect(exports[0].partner).toBe('USA');
    expect(exports[0].totalUsd).toBe(200);
  });

  it('detects when panel can show external links without DB flows', () => {
    expect(tradeEvidenceHasData({ country: 'Norway', flowCount: 0 })).toBe(true);
    expect(tradeEvidenceHasData({ flowCount: 0 })).toBe(false);
    expect(tradeEvidenceHasData({ flowCount: 3 })).toBe(true);
  });
});
