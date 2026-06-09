import { describe, expect, it } from 'vitest';
import {
  globalMapLens,
  globalMapLensHelperCopy,
  isRiskGlobalLens,
  shouldBypassCountrySummary,
  shouldDimLicenseMarkers,
  shouldShowGlobalMacroTradeFlows,
} from './globalMapLens';

describe('globalMapLens', () => {
  it('returns sublayer only for global_view mode', () => {
    expect(globalMapLens('global_view', 'licenses')).toBe('licenses');
    expect(globalMapLens('assets', 'licenses')).toBeNull();
    expect(globalMapLens('global_view', 'trade_flows')).toBe('trade_flows');
  });
});

describe('lens behavior helpers', () => {
  it('bypasses country summary for licenses lens', () => {
    expect(shouldBypassCountrySummary('licenses')).toBe(true);
    expect(shouldBypassCountrySummary('countries')).toBe(false);
    expect(shouldBypassCountrySummary(null)).toBe(false);
  });

  it('dims markers and enables macro trade for trade_flows lens', () => {
    expect(shouldDimLicenseMarkers('trade_flows')).toBe(true);
    expect(shouldShowGlobalMacroTradeFlows('trade_flows')).toBe(true);
    expect(shouldDimLicenseMarkers('countries')).toBe(false);
  });

  it('identifies risk lens', () => {
    expect(isRiskGlobalLens('risk')).toBe(true);
    expect(isRiskGlobalLens('countries')).toBe(false);
  });

  it('provides helper copy for each lens', () => {
    expect(globalMapLensHelperCopy('trade_flows').en).toContain('Comtrade');
    expect(globalMapLensHelperCopy('risk').en).toContain('OpenSanctions');
  });
});
