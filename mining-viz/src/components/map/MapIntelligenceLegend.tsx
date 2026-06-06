import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { IntelligenceMode, IntelligenceSublayer } from '../../lib/intelligenceModes';
import { globalMapLens } from '../../lib/globalMapLens';
import { assetsMapLens } from '../../lib/assetsMapLens';
import { INTELLIGENCE_COLORS } from '../../lib/intelligenceColors';
import { useI18n } from '../../lib/i18n';

type Props = {
  mode: IntelligenceMode;
  sublayer: IntelligenceSublayer;
  globalMacroTradeOn?: boolean;
  onGlobalMacroTradeChange?: (on: boolean) => void;
};

const LEGEND_ITEMS = [
  { key: 'cluster', color: INTELLIGENCE_COLORS.clusterBase, label: 'Cluster' },
  { key: 'hotspot', color: INTELLIGENCE_COLORS.clusterHotspot, label: 'Hotspot (2.5k+)' },
  { key: 'border', color: INTELLIGENCE_COLORS.borderDefault, label: 'Country border' },
  { key: 'mining', color: INTELLIGENCE_COLORS.mining, label: 'Mine' },
  { key: 'oil', color: INTELLIGENCE_COLORS.oilGas, label: 'Oil & Gas license' },
  { key: 'refinery', color: '#fb923c', label: 'Refinery (OSM)' },
  { key: 'storage', color: '#eab308', label: 'Storage / tank farm' },
  { key: 'pipeline', color: '#fbbf24', label: 'Pipeline (OSM/GEM)' },
  { key: 'port', color: INTELLIGENCE_COLORS.ports, label: 'Port' },
  { key: 'vessel', color: INTELLIGENCE_COLORS.vessels, label: 'Vessel' },
  { key: 'supplier', color: INTELLIGENCE_COLORS.supplierGood, label: 'Supplier / DD' },
  { key: 'macro_trade', color: '#64748b', label: 'Macro trade arc (Comtrade)' },
  { key: 'esg', color: '#059669', label: 'ESG protected zone' },
  { key: 'coverage', color: '#f59e0b', label: 'AIS coverage gap' },
  { key: 'sanctions_flagged', color: '#ef4444', label: 'Sanctions — flagged' },
  { key: 'sanctions_review', color: '#f59e0b', label: 'Sanctions — review' },
  { key: 'sanctions_clear', color: '#94a3b8', label: 'Screened — clear' },
  { key: 'sanctions_unknown', color: '#64748b', label: 'No screening data' },
] as const;

function itemsForGlobalLens(lens: NonNullable<ReturnType<typeof globalMapLens>>) {
  switch (lens) {
    case 'countries':
      return LEGEND_ITEMS.filter((i) => ['cluster', 'hotspot', 'border'].includes(i.key));
    case 'licenses':
      return LEGEND_ITEMS.filter((i) => ['cluster', 'mining', 'oil', 'border'].includes(i.key));
    case 'trade_flows':
      return LEGEND_ITEMS.filter((i) => ['macro_trade', 'border'].includes(i.key));
    case 'risk':
      return LEGEND_ITEMS.filter((i) =>
        [
          'esg',
          'coverage',
          'sanctions_flagged',
          'sanctions_review',
          'sanctions_clear',
          'sanctions_unknown',
          'border',
        ].includes(i.key),
      );
  }
}

const RISK_SANCTIONS_DISCLAIMER =
  'Screening signal — not legal determination. Untinted borders = no stored screening (unknown, not clear).';

function itemsForAssetsLens(lens: NonNullable<ReturnType<typeof assetsMapLens>>) {
  switch (lens) {
    case 'mines':
      return LEGEND_ITEMS.filter((i) => ['mining', 'cluster', 'border'].includes(i.key));
    case 'ports':
      return LEGEND_ITEMS.filter((i) => ['port', 'border'].includes(i.key));
    case 'oil_fields':
      return LEGEND_ITEMS.filter((i) => ['oil', 'pipeline', 'cluster', 'border'].includes(i.key));
    case 'refineries':
      return LEGEND_ITEMS.filter((i) => ['refinery', 'oil', 'border'].includes(i.key));
    case 'tank_farms':
      return LEGEND_ITEMS.filter((i) => ['storage', 'border'].includes(i.key));
  }
}

function itemsForMode(mode: IntelligenceMode, sublayer: IntelligenceSublayer) {
  const globalLens = globalMapLens(mode, sublayer);
  if (globalLens) return itemsForGlobalLens(globalLens);
  const assetsLens = assetsMapLens(mode, sublayer);
  if (assetsLens) return itemsForAssetsLens(assetsLens);
  if (mode === 'supply_chain') {
    return LEGEND_ITEMS.filter((i) => ['supplier', 'cluster', 'border'].includes(i.key));
  }
  if (mode === 'routes') {
    return LEGEND_ITEMS.filter((i) => ['vessel', 'port', 'border'].includes(i.key));
  }
  return LEGEND_ITEMS;
}

export function MapIntelligenceLegend({
  mode,
  sublayer,
  globalMacroTradeOn = true,
  onGlobalMacroTradeChange,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const lens = globalMapLens(mode, sublayer);
  const items = itemsForMode(mode, sublayer);

  return (
    <div className="absolute right-4 bottom-20 z-[940] pointer-events-auto max-w-[14rem]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 shadow-lg backdrop-blur-xl"
      >
        <Info className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span className="flex-1 text-left">{t('מקרא', 'Legend')}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <ul className="mt-1 rounded-xl border border-stone-200/90 dark:border-white/10 bg-stone-50/98 dark:bg-slate-950/95 p-2 space-y-1.5 shadow-xl backdrop-blur-xl">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-[9px] font-bold text-slate-600 dark:text-slate-300">
              <span
                className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: item.color }}
              />
              {t(item.label, item.label)}
            </li>
          ))}
          {onGlobalMacroTradeChange && lens === 'trade_flows' && (
            <li className="pt-1 border-t border-black/5 dark:border-white/10">
              <label className="flex cursor-pointer items-center gap-2 text-[9px] font-bold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={globalMacroTradeOn}
                  onChange={(e) => onGlobalMacroTradeChange(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-stone-300 accent-slate-500 dark:border-white/20"
                />
                {t('הצג קשתות מאקרו', 'Show macro arcs')}
              </label>
            </li>
          )}
          {lens === 'risk' && (
            <li className="pt-1.5 text-[8px] leading-snug font-semibold text-slate-500 border-t border-black/5 dark:border-white/10">
              {t(RISK_SANCTIONS_DISCLAIMER, RISK_SANCTIONS_DISCLAIMER)}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
