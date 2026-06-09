import type { GlobalSublayer, IntelligenceMode, IntelligenceSublayer } from './intelligenceModes';

export type GlobalMapLens = GlobalSublayer;

/** Active Global cockpit lens, or null when not in Global mode. */
export function globalMapLens(
  mode: IntelligenceMode,
  sublayer: IntelligenceSublayer,
): GlobalMapLens | null {
  if (mode !== 'global_view') return null;
  return sublayer as GlobalMapLens;
}

export function shouldBypassCountrySummary(lens: GlobalMapLens | null): boolean {
  return lens === 'licenses';
}

export function shouldDimLicenseMarkers(lens: GlobalMapLens | null): boolean {
  return lens === 'trade_flows';
}

export function shouldShowGlobalMacroTradeFlows(lens: GlobalMapLens | null): boolean {
  return lens === 'trade_flows';
}

export function isRiskGlobalLens(lens: GlobalMapLens | null): boolean {
  return lens === 'risk';
}

export function globalMapLensHelperCopy(lens: GlobalMapLens): { en: string; he: string } {
  switch (lens) {
    case 'countries':
      return {
        en: 'Country opportunity hubs',
        he: 'מרכזי פעילות לפי מדינה',
      };
    case 'licenses':
      return {
        en: 'Asset inventory and drill-down markers',
        he: 'סימוני רישיון בודדים',
      };
    case 'trade_flows':
      return {
        en: 'Macro commodity corridors (Comtrade)',
        he: 'מסדרונות סחר מאקרו (Comtrade)',
      };
    case 'risk':
      return {
        en: 'Risk signals, data coverage and OpenSanctions screening',
        he: 'ESG, פערי כיסוי וסינון OpenSanctions',
      };
  }
}
