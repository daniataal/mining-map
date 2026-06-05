import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import type { IntelligenceMode, IntelligenceSublayer } from '../../lib/intelligenceModes';
import { INTELLIGENCE_COLORS } from '../../lib/intelligenceColors';
import { useI18n } from '../../lib/i18n';

type Props = {
  mode: IntelligenceMode;
  sublayer: IntelligenceSublayer;
};

const LEGEND_ITEMS = [
  { key: 'cluster', color: INTELLIGENCE_COLORS.clusterBase, label: 'Cluster' },
  { key: 'hotspot', color: INTELLIGENCE_COLORS.clusterHotspot, label: 'Hotspot (2.5k+)' },
  { key: 'border', color: INTELLIGENCE_COLORS.borderDefault, label: 'Country border' },
  { key: 'mining', color: INTELLIGENCE_COLORS.mining, label: 'Mine' },
  { key: 'oil', color: INTELLIGENCE_COLORS.oilGas, label: 'Oil & Gas' },
  { key: 'port', color: INTELLIGENCE_COLORS.ports, label: 'Port' },
  { key: 'vessel', color: INTELLIGENCE_COLORS.vessels, label: 'Vessel' },
  { key: 'supplier', color: INTELLIGENCE_COLORS.supplierGood, label: 'Supplier / DD' },
] as const;

function itemsForMode(mode: IntelligenceMode, sublayer: IntelligenceSublayer) {
  if (mode === 'supply_chain') {
    return LEGEND_ITEMS.filter((i) => ['supplier', 'cluster', 'border'].includes(i.key));
  }
  if (mode === 'routes') {
    return LEGEND_ITEMS.filter((i) => ['vessel', 'port', 'border'].includes(i.key));
  }
  if (mode === 'assets') {
    if (sublayer === 'ports') return LEGEND_ITEMS.filter((i) => ['port', 'border'].includes(i.key));
    if (sublayer === 'oil_fields' || sublayer === 'refineries' || sublayer === 'tank_farms') {
      return LEGEND_ITEMS.filter((i) => ['oil', 'port', 'cluster'].includes(i.key));
    }
    return LEGEND_ITEMS.filter((i) => ['mining', 'cluster', 'border'].includes(i.key));
  }
  return LEGEND_ITEMS;
}

export function MapIntelligenceLegend({ mode, sublayer }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
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
        </ul>
      )}
    </div>
  );
}
