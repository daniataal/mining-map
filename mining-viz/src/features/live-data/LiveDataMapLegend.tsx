import { useI18n } from '../../lib/i18n';
import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';

type Props = {
  layers: OilLiveLayerVisibility;
  eiaHistoricOn?: boolean;
  macroTradeOn?: boolean;
};

const SWATCHES: { key: string; color: string; dash?: string; labelEn: string; labelHe: string }[] = [
  {
    key: 'mcr',
    color: '#f59e0b',
    dash: '8 6',
    labelEn: 'Shipment routes (MCR)',
    labelHe: 'מסלולי מטען (MCR)',
  },
  {
    key: 'agg',
    color: '#8b5cf6',
    dash: '6 4',
    labelEn: 'Aggregated trade pairs',
    labelHe: 'זוגות מסחר מצרפיים',
  },
  {
    key: 'macro',
    color: '#64748b',
    dash: '4 6',
    labelEn: 'Country macro (Comtrade)',
    labelHe: 'מאקרו מדינות',
  },
  {
    key: 'eia',
    color: '#a855f7',
    dash: '10 8',
    labelEn: 'EIA historic imports',
    labelHe: 'יבוא היסטורי EIA',
  },
  {
    key: 'terminal',
    color: '#2563eb',
    labelEn: 'Terminals',
    labelHe: 'מסופים',
  },
];

export default function LiveDataMapLegend({ layers, eiaHistoricOn, macroTradeOn }: Props) {
  const { t } = useI18n();

  const active = SWATCHES.filter((s) => {
    if (s.key === 'mcr') return layers.corridors;
    if (s.key === 'agg') return layers.tradeFlows;
    if (s.key === 'macro') return macroTradeOn;
    if (s.key === 'eia') return eiaHistoricOn;
    if (s.key === 'terminal') return layers.terminals;
    return false;
  });

  if (active.length === 0) return null;

  return (
    <div className="pointer-events-auto rounded-lg border border-stone-200/90 dark:border-white/10 bg-white/95 dark:bg-slate-900/95 shadow-md px-2.5 py-2 max-w-[220px]">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
        {t('מקרא מפה', 'Map legend')}
      </p>
      <ul className="space-y-1">
        {active.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="shrink-0 w-6 h-0.5 rounded-full"
              style={{
                backgroundColor: s.dash ? 'transparent' : s.color,
                borderTop: s.dash ? `2px dashed ${s.color}` : undefined,
              }}
            />
            <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200">
              {t(s.labelHe, s.labelEn)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
