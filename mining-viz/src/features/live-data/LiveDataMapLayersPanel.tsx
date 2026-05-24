import { Anchor, Archive, ArrowRightLeft, Globe2, Layers, Radar, Route, Ship, Sparkles } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OilLiveSyncStatus } from '../../api/oilLiveApi';
import type { OilLiveLayerVisibility } from '../../components/petroleum/OilLiveMapOverlays';

import { OIL_LIVE_MAP_VESSEL_FETCH_CAP } from './liveDataMapDefaults';
import { resolveLiveDataVesselStatus } from './liveDataVesselStatus';
import { canToggleGovernmentAisCoverage } from './liveDataDevFeatures';

export type LiveDataMapLayersPanelProps = {
  layers: OilLiveLayerVisibility;
  onLayersChange: (layers: OilLiveLayerVisibility) => void;
  coverageStats?: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
  } | null;
  macroTradeEnabled?: boolean;
  onMacroTradeChange?: (on: boolean) => void;
  allMaritimeEnabled: boolean;
  onAllMaritimeChange: (enabled: boolean) => void;
  globalMaritimeCount?: number | null;
  /** Dev toggle: filter AIS coverage overlay to government sources (BarentsWatch). */
  governmentAisCoverageEnabled?: boolean;
  onGovernmentAisCoverageChange?: (enabled: boolean) => void;
  /** Aggregated Trade Flow layer group selector (company_pair vs country_pair). */
  tradeFlowGroup?: TradeFlowGroup;
  onTradeFlowGroupChange?: (group: TradeFlowGroup) => void;
  /** Global ledger counts from GET /api/oil-live/sync-status (AIS coverage health). */
  syncStatus?: OilLiveSyncStatus | null;
  /** EIA historic import arcs (Historic group — off by default). */
  eiaHistoricEnabled?: boolean;
  onEiaHistoricChange?: (on: boolean) => void;
  eiaHistoricRowCount?: number | null;
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
    key: 'coverage' as const,
    icon: Radar,
    labelEn: 'AIS coverage',
    labelHe: 'כיסוי AIS',
    hintEn: 'Sparse/gap overlay for open AIS sources',
    hintHe: 'שכבת חוסרים ודלילות למקורות AIS פתוחים',
  },
  {
    key: 'corridors' as const,
    icon: Route,
    labelEn: 'Shipment routes (MCR)',
    labelHe: 'מסלולי מטען (MCR)',
    hintEn: 'Per-shipment synthetic arcs in view',
    hintHe: 'קשתות מטען סינתטי בתצוגה',
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
  governmentAisCoverageEnabled = false,
  onGovernmentAisCoverageChange,
  tradeFlowGroup = 'company_pair',
  onTradeFlowGroupChange,
  macroTradeEnabled = true,
  onMacroTradeChange,
  syncStatus,
  eiaHistoricEnabled = false,
  onEiaHistoricChange,
  eiaHistoricRowCount,
}: LiveDataMapLayersPanelProps) {
  const { t } = useI18n();

  const fmtCount = (n: number | undefined) =>
    n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  function toggleLayer(key: keyof OilLiveLayerVisibility) {
    onLayersChange({ ...layers, [key]: !layers[key] });
  }

  const tradeFlowsOn = Boolean(layers.tradeFlows);
  const coverageNeedsAttention =
    syncStatus != null &&
    ((syncStatus.coverage_gap_watch_zone_count ?? 0) > 0 || syncStatus.live_vessel_count === 0);

  const vesselWatchStatus =
    layers.vessels
      ? resolveLiveDataVesselStatus({
          vesselsInView: coverageStats?.vessels ?? 0,
          syncStatus,
          allMaritimeEnabled: allMaritimeEnabled,
        })
      : null;

  return (
    <div className="w-[min(100vw-2rem,420px)] rounded-2xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
      <div className="border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10">
            <Layers className="h-4 w-4 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black uppercase tracking-widest text-amber-500">
              {t('עדשת עסקאות חיות', 'Live Deal Lens')}
            </p>
            <p className="text-base leading-snug text-slate-700 dark:text-slate-200">
              {t('ספקים · קונים · מסלולים · תשתית', 'Suppliers · buyers · routes · infrastructure')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-3">
        <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
          {t(
            'מציג שכבות עסקה שימושיות במסך אחד: מסופים, מכליות, MCR, זוגות סחר וכיסוי AIS.',
            'Shows deal-useful layers in one smooth canvas pass: terminals, tankers, MCRs, trade pairs, and AIS coverage.',
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
            {t('הזדמנויות', 'opportunities')} ·{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">{coverageStats.corridors}</span>{' '}
            {t('מסדרונות', 'corridors')}
          </p>
        )}
        {layers.corridors && coverageStats != null && coverageStats.corridors === 0 && (
          <p className="text-xs leading-relaxed text-violet-800 dark:text-violet-200">
            {t(
              'מסדרונות = קשתות MCR (מטען סינתטי) בתצוגה. התקרבו למפרץ/ים פנימיים או הפעילו graph-sync אם אין רשומות.',
              'Corridors = per-shipment MCR arcs in view. Zoom to a hub (e.g. Gulf) or run graph-sync if the ledger is empty.',
            )}
          </p>
        )}
        {coverageStats != null && coverageStats.vessels === 0 && (
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {t(
              'אין ספינות בתצוגה לא אומר שאין פעילות. בדקו את שכבת כיסוי AIS כדי לראות חורי דאטה.',
              'No vessels in view does not mean no activity. Check the AIS coverage layer for data gaps.',
            )}
          </p>
        )}

        {layers.vessels && (
          <div
            className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs leading-relaxed text-sky-950 dark:text-sky-100"
            role="status"
          >
            <p className="text-[10px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">
              {t('מעקב מכליות', 'Vessel watch')}
            </p>
            <p className="mt-1">
              {t(vesselWatchStatus!.headlineHe, vesselWatchStatus!.headlineEn)}
            </p>
            {vesselWatchStatus!.detailEn && vesselWatchStatus!.detailHe && (
              <p className="mt-1 opacity-85">
                {t(vesselWatchStatus!.detailHe, vesselWatchStatus!.detailEn)}
              </p>
            )}
            <p className="mt-1 opacity-85">
              {t(
                `מגבלת fetch ${OIL_LIVE_MAP_VESSEL_FETCH_CAP} · ברירת מחדל: מכליות oil-live (לא AIS גלובלי)`,
                `Fetch cap ${OIL_LIVE_MAP_VESSEL_FETCH_CAP} · default: oil-live tankers (not global AIS)`,
              )}
            </p>
          </div>
        )}

        {syncStatus && (
          <div
            className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
              layers.coverage
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-100'
                : 'border-slate-500/20 bg-slate-500/5 text-slate-600 dark:text-slate-400'
            }`}
          >
            <p className="text-[10px] font-black uppercase tracking-wide text-rose-700 dark:text-rose-300">
              {t('בריאות AIS (מסד נתונים)', 'AIS health (database)')}
            </p>
            <p className="mt-1">
              {t('כלי שיט חיים', 'Live vessels')}:{' '}
              <span className="font-semibold">{fmtCount(syncStatus.live_vessel_count)}</span>
              {' · '}
              {t('קריאות נמל AIS', 'AIS port calls')}:{' '}
              <span className="font-semibold">
                {fmtCount(syncStatus.live_ais_port_call_count ?? syncStatus.port_call_count)}
              </span>
              {' · '}
              {t('אזורי חוסר', 'Gap zones')}:{' '}
              <span className="font-semibold">{fmtCount(syncStatus.coverage_gap_watch_zone_count)}</span>
              {syncStatus.coverage_watch_zone_count != null && (
                <>
                  {' · '}
                  {t('אזורי מעקב', 'Watch zones')}:{' '}
                  <span className="font-semibold">{fmtCount(syncStatus.coverage_watch_zone_count)}</span>
                </>
              )}
            </p>
            {!layers.coverage && (
              <p className="mt-1 opacity-80">
                {t(
                  'הפעילו שכבת כיסוי AIS כדי לצייר חורים בתצוגה.',
                  'Turn on the AIS coverage layer to draw gap cells in the viewport.',
                )}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {LAYER_META.map(({ key, icon: Icon, labelEn, labelHe, hintEn, hintHe }) => {
            const on = layers[key];
            const coverageHighlight = key === 'coverage' && coverageNeedsAttention && !on;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleLayer(key)}
                className={`flex min-h-[52px] flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? 'border-amber-500/40 bg-amber-500/15 text-slate-900 dark:text-slate-100'
                    : coverageHighlight
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-950 dark:text-rose-100'
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

        {onEiaHistoricChange && (
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-2.5">
            <p className="text-[10px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-2">
              {t('היסטורי', 'Historic')}
            </p>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={eiaHistoricEnabled}
                onChange={(e) => onEiaHistoricChange(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  <Archive className="h-4 w-4 shrink-0" />
                  {t('קשתות יבוא EIA', 'EIA historic import arcs')}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-600 dark:text-slate-400">
                  {t(
                    'bol_tier=historic — קבצי impa EIA, לא מכס ולא AIS חי.',
                    'bol_tier=historic — EIA impa files, not customs BOL or live AIS.',
                  )}
                </span>
                {eiaHistoricRowCount != null && eiaHistoricRowCount > 0 && (
                  <span className="mt-1 block text-[10px] tabular-nums text-slate-500">
                    {eiaHistoricRowCount.toLocaleString()} {t('שורות במסד', 'rows in DB')}
                  </span>
                )}
              </span>
            </label>
          </div>
        )}

        {onMacroTradeChange && (
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-500/30 bg-slate-500/5 px-3 py-2">
            <input
              type="checkbox"
              checked={macroTradeEnabled}
              onChange={(e) => onMacroTradeChange(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span className="flex items-center gap-1.5 text-xs font-black uppercase text-slate-700 dark:text-slate-200">
              <Globe2 className="h-3.5 w-3.5" />
              {t('מסדרונות מאקרו (Comtrade)', 'Macro trade corridors')}
            </span>
          </label>
        )}

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
                {t('זוגות מסחר מצרפיים', 'Aggregated trade pairs')}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-600 dark:text-slate-400">
                {t(
                  'קשתות מרוכזות לפי זוג חברות או מדינות (לא כל משלוח בנפרד).',
                  'Rolled-up arcs by company or country pair — not every shipment.',
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

        {canToggleGovernmentAisCoverage() && onGovernmentAisCoverageChange && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={governmentAisCoverageEnabled}
                onChange={(e) => onGovernmentAisCoverageChange(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span className="min-w-0">
                <span className="block text-sm font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  {t('כיסוי AIS ממשלתי (נורווגיה)', 'Government AIS coverage (Norway)')}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {t(
                    'מסנן שכבת כיסוי ל-BarentsWatch בלבד. לא מכסה מפרץ/אפריקה — לבדיקת ingest אזורי.',
                    'Filters the coverage overlay to BarentsWatch only. Does not cover Gulf/Africa — for regional ingest QA.',
                  )}
                </span>
              </span>
            </label>
          </div>
        )}

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
