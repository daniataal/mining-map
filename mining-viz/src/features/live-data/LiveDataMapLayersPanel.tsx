import { Anchor, ArrowRightLeft, Layers, Route, Ship, Sparkles } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';

export type TradeFlowGroup = 'company_pair' | 'country_pair';

export type LiveDataMapLayersPanelProps = {
  layers: OilLiveLayerVisibility;
  onLayersChange: (layers: OilLiveLayerVisibility) => void;
  coverageStats?: { terminals: number; vessels: number; opportunities: number } | null;
  allMaritimeEnabled: boolean;
  onAllMaritimeChange: (enabled: boolean) => void;
  globalMaritimeCount?: number | null;
  /** Aggregated Trade Flow layer group selector (company_pair vs country_pair). */
  tradeFlowGroup?: TradeFlowGroup;
  onTradeFlowGroupChange?: (group: TradeFlowGroup) => void;
};

const LAYER_META = [
  {
    key: 'terminals' as const,
    icon: Anchor,
    labelEn: 'Terminals',
    labelHe: 'מסופים',
    hintEn: 'Storage hubs and load/discharge points',
    hintHe: 'מרכזי אחסון ונקודות טעינה/פריקה',
  },
  {
    key: 'vessels' as const,
    icon: Ship,
    labelEn: 'Vessels',
    labelHe: 'כלי שיט',
    hintEn: 'Oil/tanker AIS near terminals (capped)',
    hintHe: 'AIS מכליות ליד מסופים (מוגבל)',
  },
  {
    key: 'corridors' as const,
    icon: Route,
    labelEn: 'Corridors',
    labelHe: 'מסדרונות',
    hintEn: 'Inferred trade routes from cargo signals',
    hintHe: 'מסלולי מסחר מסיקת רשומות מטען',
  },
  {
    key: 'opportunities' as const,
    icon: Sparkles,
    labelEn: 'Opportunities',
    labelHe: 'הזדמנויות',
    hintEn: 'High-confidence deal hypotheses on map',
    hintHe: 'השערות עסקה בביטחון גבוה על המפה',
  },
];

export default function LiveDataMapLayersPanel({
  layers,
  onLayersChange,
  coverageStats,
  allMaritimeEnabled,
  onAllMaritimeChange,
  globalMaritimeCount,
  tradeFlowGroup = 'company_pair',
  onTradeFlowGroupChange,
}: LiveDataMapLayersPanelProps) {
  const { t } = useI18n();

  function toggleLayer(key: keyof OilLiveLayerVisibility) {
    onLayersChange({ ...layers, [key]: !layers[key] });
  }

  const tradeFlowsOn = Boolean(layers.tradeFlows);

  return (
    <div className="w-[min(100vw-2rem,420px)] rounded-2xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
      <div className="border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
            <Layers className="h-4 w-4 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase tracking-widest text-amber-500">
              {t('שכבות מפת נתונים חיים', 'Live Data map layers')}
            </p>
            <p className="text-base leading-snug text-slate-700 dark:text-slate-200">
              {t('מסופים · מכליות · מסדרונות · הזדמנויות', 'Terminals · tankers · corridors · opportunities')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3">
        <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
          {t(
            'שכבת כלי השיט מציגה מיקומי מכליות/נפט ליד מסופים. כבו אם המפה איטית.',
            'Vessel layer shows oil/tanker positions near terminals. Turn off if the map is slow.',
          )}
        </p>

        {coverageStats && (
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {t('בתצוגה', 'In view')}:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{coverageStats.terminals}</span>{' '}
            {t('מסופים', 'terminals')} ·{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{coverageStats.vessels}</span>{' '}
            {t('מכליות', 'tankers')} ·{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{coverageStats.opportunities}</span>{' '}
            {t('הזדמנויות', 'opportunities')}
          </p>
        )}
        {coverageStats != null && coverageStats.vessels === 0 && (
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {t(
              'מכליות דורשות AIS חי (AISSTREAM_API_KEY).',
              'Vessels require live AIS (AISSTREAM_API_KEY).',
            )}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {LAYER_META.map(({ key, icon: Icon, labelEn, labelHe, hintEn, hintHe }) => {
            const on = layers[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLayer(key)}
                className={`flex min-h-[52px] flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? 'border-amber-500/40 bg-amber-500/15 text-slate-900 dark:text-slate-100'
                    : 'border-black/10 bg-white/80 text-slate-600 dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-400'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wide">
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(labelHe, labelEn)}
                </span>
                <span className="mt-0.5 text-xs leading-snug opacity-80">{t(hintHe, hintEn)}</span>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={tradeFlowsOn}
              onChange={(e) => onLayersChange({ ...layers, tradeFlows: e.target.checked })}
              className="mt-1 h-4 w-4 rounded border-slate-300"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">
                <ArrowRightLeft className="h-4 w-4 shrink-0" />
                {t('זרימת סחר (מצרפי)', 'Trade Flow (aggregated)')}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-600 dark:text-slate-400">
                {t(
                  'קשתות מצרפיות לפי זוג חברות או זוג מדינות, מצויירות מ-MCR.',
                  'Aggregated arcs by company pair or country pair, drawn from MCR.',
                )}
              </span>
              <div
                className={`mt-2 flex gap-1.5 transition-opacity ${
                  tradeFlowsOn ? 'opacity-100' : 'opacity-40 pointer-events-none'
                }`}
                role="group"
                aria-label={t('קיבוץ זרימות סחר', 'Trade Flow grouping')}
              >
                {(
                  [
                    { key: 'company_pair' as const, en: 'Company', he: 'חברה' },
                    { key: 'country_pair' as const, en: 'Country', he: 'מדינה' },
                  ]
                ).map((opt) => {
                  const active = tradeFlowGroup === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!tradeFlowsOn || !onTradeFlowGroupChange}
                      onClick={() => onTradeFlowGroupChange?.(opt.key)}
                      className={`flex-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide transition-colors ${
                        active
                          ? 'bg-violet-500 text-white'
                          : 'border border-violet-500/30 text-violet-700 hover:bg-violet-500/10 dark:text-violet-200'
                      }`}
                    >
                      {t(opt.he, opt.en)}
                    </button>
                  );
                })}
              </div>
            </span>
          </label>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={allMaritimeEnabled}
              onChange={(e) => onAllMaritimeChange(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300"
            />
            <span className="min-w-0">
              <span className="block text-sm font-black uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                {t('כל AIS ימי (מתקדם)', 'All maritime AIS (advanced)')}
              </span>
              <span className="mt-0.5 block text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {globalMaritimeCount != null
                  ? t(
                      `מאגר גלובלי ~${globalMaritimeCount.toLocaleString()} כלי שיט — כבד; ברירת מחדל: מכליות oil-live בלבד.`,
                      `Global feed ~${globalMaritimeCount.toLocaleString()} vessels — heavy; default is oil-live tankers only.`,
                    )
                  : t(
                      'מאגר AIS גלובלי (אלפי כלי שיט) — כבד; ברירת מחדל: מכליות oil-live בלבד.',
                      'Global AIS snapshot (thousands of vessels) — heavy; default is oil-live tankers only.',
                    )}
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
