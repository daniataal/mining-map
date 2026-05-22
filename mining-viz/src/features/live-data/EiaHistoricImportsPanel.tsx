import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Crosshair, Loader2, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../lib/i18n';
import CollapsibleSection from '../../components/ui/CollapsibleSection';
import {
  getEiaHistoricMap,
  getEiaHistoricSeries,
  getEiaHistoricSummary,
  type EiaHistoricMapArc,
  type EiaHistoricMapOrigin,
} from '../../api/eiaHistoricApi';
import {
  EIA_HISTORIC_STALE_MS,
  eiaHistoricMapQueryKey,
  eiaHistoricSummaryQueryKey,
} from '../../hooks/use-petroleum-sidebar-prefetch';
import { getOilLiveSyncStatus } from '../../api/oilLiveApi';

const SHELL = 'rounded-lg border border-black/5 dark:border-white/10 bg-white/60 dark:bg-slate-900/40 p-3';
const LABEL = 'text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400';
const MUTED = 'text-xs leading-relaxed text-slate-600 dark:text-slate-400';

const EIA_INGEST_CURL = `curl -X POST "http://localhost:8000/api/admin/eia-historic-imports/ingest" \\
  -H "X-Admin-Token: $ADMIN_TOKEN"`;

function formatBbl(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B bbl`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M bbl`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(0)}K bbl`;
  return `${Math.round(val)} bbl`;
}

function EiaVolumeChart({
  points,
}: {
  points: { period: string; volume_bbl: number }[];
}) {
  if (points.length < 1) return null;
  const maxVal = Math.max(1, ...points.map((p) => p.volume_bbl));
  const chartW = 280;
  const chartH = 56;
  const barW = Math.min(16, Math.max(3, chartW / Math.max(points.length, 1) - 2));

  return (
    <svg
      viewBox={`0 0 ${chartW} ${chartH + 12}`}
      className="w-full h-auto text-violet-400"
      role="img"
      aria-label="Historic import volume over time"
    >
      {points.map((p, i) => {
        const h = (p.volume_bbl / maxVal) * chartH;
        const x = 4 + i * (barW + 3);
        return (
          <g key={p.period}>
            <rect
              x={x}
              y={chartH - h}
              width={barW}
              height={Math.max(h, 1)}
              fill="currentColor"
              opacity={0.85}
              rx={1}
            />
            {points.length <= 24 && (
              <text x={x + barW / 2} y={chartH + 10} textAnchor="middle" className="fill-slate-500 text-[6px]">
                {p.period.length > 7 ? p.period.slice(2) : p.period}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export type EiaHistoricImportsPanelProps = {
  onMapArcsChange?: (payload: {
    enabled: boolean;
    arcs: EiaHistoricMapArc[];
    origins?: EiaHistoricMapOrigin[];
    year: number;
    showCorridors: boolean;
  }) => void;
  /** Set when user picks an importer from a map origin popup */
  importerFromMap?: string | null;
  onImporterFromMapConsumed?: () => void;
};

export default function EiaHistoricImportsPanel({
  onMapArcsChange,
  importerFromMap,
  onImporterFromMapConsumed,
}: EiaHistoricImportsPanelProps) {
  const { t } = useI18n();
  const [importer, setImporter] = useState('');
  const [importerDraft, setImporterDraft] = useState('');
  const [year, setYear] = useState(2020);
  const [showOnMap, setShowOnMap] = useState(true);
  const [showCorridors, setShowCorridors] = useState(false);
  const [ingestCurlOpen, setIngestCurlOpen] = useState(false);

  const applyImporter = () => setImporter(importerDraft.trim());

  useEffect(() => {
    if (!importerFromMap?.trim()) return;
    setImporterDraft(importerFromMap.trim());
    setImporter(importerFromMap.trim());
    onImporterFromMapConsumed?.();
  }, [importerFromMap, onImporterFromMapConsumed]);

  const summaryQuery = useQuery({
    queryKey: eiaHistoricSummaryQueryKey(importer),
    queryFn: () => getEiaHistoricSummary({ importer: importer || undefined }),
    staleTime: EIA_HISTORIC_STALE_MS,
    refetchInterval: (q) =>
      q.state.data?.row_count === 0 && !q.state.isFetching ? 20_000 : false,
  });

  const syncStatusQuery = useQuery({
    queryKey: ['oil-live-sync-status'],
    queryFn: getOilLiveSyncStatus,
    staleTime: 60_000,
    refetchInterval: (q) => {
      const eia = q.state.data?.eia_historic_import_count ?? 0;
      return eia === 0 ? 15_000 : false;
    },
  });

  const yearMin = summaryQuery.data?.year_min ?? 2000;
  const yearMax = summaryQuery.data?.year_max ?? new Date().getFullYear();

  useEffect(() => {
    if (summaryQuery.data?.year_max && year > summaryQuery.data.year_max) {
      setYear(summaryQuery.data.year_max);
    }
  }, [summaryQuery.data?.year_max, year]);

  const seriesQuery = useQuery({
    queryKey: ['eia-historic-series', importer],
    queryFn: () => getEiaHistoricSeries({ importer: importer || ' ' }),
    enabled: Boolean(importer.trim()),
    staleTime: 120_000,
  });

  const mapQuery = useQuery({
    queryKey: eiaHistoricMapQueryKey(year, importer),
    queryFn: () =>
      getEiaHistoricMap({
        year,
        importer: importer.trim() || undefined,
        limit: 80,
      }),
    enabled: showOnMap,
    staleTime: EIA_HISTORIC_STALE_MS,
  });

  const originsForYear = useMemo(() => {
    if (!summaryQuery.data?.top_origins) return [];
    return summaryQuery.data.top_origins.slice(0, 12);
  }, [summaryQuery.data?.top_origins]);

  const chartPoints = useMemo(
    () =>
      (seriesQuery.data?.points ?? []).map((p) => ({
        period: p.period,
        volume_bbl: p.volume_bbl,
      })),
    [seriesQuery.data?.points],
  );

  useEffect(() => {
    if (!onMapArcsChange) return;
    onMapArcsChange({
      enabled: showOnMap,
      arcs: showOnMap ? (mapQuery.data?.arcs ?? []) : [],
      origins: showOnMap ? mapQuery.data?.origins : undefined,
      year,
      showCorridors: showOnMap && showCorridors,
    });
  }, [showOnMap, showCorridors, mapQuery.data?.arcs, mapQuery.data?.origins, year, onMapArcsChange]);

  const topImporters = summaryQuery.data?.top_importers ?? [];
  const emptyDb = summaryQuery.data?.row_count === 0 && !summaryQuery.isLoading;
  const syncEiaCount = syncStatusQuery.data?.eia_historic_import_count;
  const ingestPending =
    emptyDb && (syncEiaCount === 0 || syncEiaCount == null) && !summaryQuery.isError;
  const rowCount = summaryQuery.data?.row_count;
  const importerCount = summaryQuery.data?.importer_count;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start gap-2">
        <Archive className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('ייבוא היסטורי (EIA)', 'Historic imports (EIA)')}
            </h3>
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-200">
              {t('היסטורי', 'Historic')}
            </span>
          </div>
          <p className={`${MUTED} mt-0.5`}>
            {t('קבצי Petroleum Supply Monthly — לא AIS חי.', 'PSM file data — not live AIS.')}
          </p>
          {!summaryQuery.isLoading && rowCount != null && rowCount > 0 && (
            <p className={`${MUTED} mt-1 tabular-nums`}>
              {rowCount.toLocaleString()} {t('שורות', 'rows')} ·{' '}
              {(importerCount ?? 0).toLocaleString()} {t('יבואנים', 'importers')}
              {syncEiaCount != null && syncEiaCount > 0 && (
                <> · sync {syncEiaCount.toLocaleString()}</>
              )}
            </p>
          )}
        </div>
      </div>

      {ingestPending && (
        <div className="rounded-lg border border-violet-500/25 bg-violet-500/8 px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
            {t('ממתין ל-ingest…', 'Waiting for ingest…')}
          </p>
          <p className={`${MUTED} mt-1`}>
            {t(
              'קבצים ב-data/eia_downloads — הריצו: docker compose up -d eia-historic-sync-worker (כמה דקות ל-39 קבצים).',
              'Files are in data/eia_downloads — run: docker compose up -d eia-historic-sync-worker (a few minutes for ~39 files).',
            )}
          </p>
        </div>
      )}

      {emptyDb && !ingestPending && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            {t('אין נתונים ב-DB', 'No data in database yet')}
          </p>
          <p className={`${MUTED} mt-1`}>
            {t(
              'הניחו impa*.xls בתיקיית data/eia_downloads והפעילו eia-historic-sync-worker.',
              'Place impa*.xls in data/eia_downloads and start eia-historic-sync-worker.',
            )}
          </p>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200"
            onClick={() => setIngestCurlOpen((v) => !v)}
          >
            <Terminal className="h-3 w-3" />
            {ingestCurlOpen ? t('הסתר', 'Hide') : t('פקודת ingest', 'Ingest command')}
          </button>
          {ingestCurlOpen && (
            <>
              <pre className="mt-2 overflow-x-auto rounded border border-black/10 bg-slate-950 px-2 py-1.5 text-[10px] text-emerald-300">
                {EIA_INGEST_CURL}
              </pre>
              <button
                type="button"
                className="mt-1.5 text-[10px] font-bold uppercase text-sky-600 dark:text-sky-400"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(EIA_INGEST_CURL);
                    toast.success(t('הועתק', 'Copied'));
                  } catch {
                    toast.error(t('העתקה נכשלה', 'Copy failed'));
                  }
                }}
              >
                {t('העתק', 'Copy')}
              </button>
            </>
          )}
        </div>
      )}

      <div className={SHELL}>
        <label className={`${LABEL} block mb-1.5`}>{t('יבואן', 'Importer')}</label>
        <input
          type="search"
          list="eia-importer-suggestions"
          value={importerDraft}
          onChange={(e) => setImporterDraft(e.target.value)}
          onBlur={applyImporter}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyImporter();
          }}
          placeholder={t('Chevron, Exxon…', 'Chevron, Exxon…')}
          className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-sm"
        />
        <datalist id="eia-importer-suggestions">
          {topImporters.map((row) => (
            <option key={row.importer_name} value={row.importer_name} />
          ))}
        </datalist>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={LABEL}>
            {t('שנה', 'Year')} {year}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={showOnMap}
              onChange={(e) => setShowOnMap(e.target.checked)}
              className="accent-violet-600"
            />
            <Crosshair className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
              {t('מפה', 'Map')}
            </span>
          </label>
        </div>
        {showOnMap && (
          <label className="mt-2 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCorridors}
              onChange={(e) => setShowCorridors(e.target.checked)}
              className="accent-violet-600"
            />
            <span className={`${MUTED} text-[10px]`}>
              {t('קווי זרימה (אופציונלי)', 'Flow lines (optional)')}
            </span>
          </label>
        )}
        {showOnMap && (
          <p className={`${MUTED} mt-1.5`}>
            {t(
              'לחצו נקודה — חץ ממקור לארה״ב. קווים לכל המקורות רק עם flow lines.',
              'Click a dot — arrow from origin to U.S. Optional flow lines shows all routes.',
            )}
          </p>
        )}
        <input
          type="range"
          min={yearMin}
          max={yearMax}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="mt-1 w-full accent-violet-600"
          disabled={emptyDb}
        />
        <div className="flex justify-between text-[9px] text-slate-500">
          <span>{yearMin}</span>
          <span>{yearMax}</span>
        </div>
        {showOnMap && mapQuery.isFetching && (
          <p className={`${MUTED} mt-1.5 flex items-center gap-1`}>
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('טוען קשתות…', 'Loading arcs…')}
          </p>
        )}
      </div>

      {summaryQuery.isLoading && (
        <p className={`${MUTED} flex items-center gap-1.5 px-1`}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('טוען…', 'Loading…')}
        </p>
      )}

      {importer.trim() && (
        <CollapsibleSection
          defaultOpen
          className={SHELL}
          title={
            <span className={`${LABEL} text-violet-700 dark:text-violet-300`}>
              {t('נפח לאורך זמן', 'Volume over time')} · {importer}
            </span>
          }
        >
          {seriesQuery.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
          ) : chartPoints.length > 0 ? (
            <EiaVolumeChart points={chartPoints} />
          ) : (
            <p className={MUTED}>{t('אין נקודות ליבואן זה', 'No series for this importer')}</p>
          )}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        defaultOpen={originsForYear.length > 0}
        className={SHELL}
        title={<span className={LABEL}>{t('מקורות מובילים', 'Top origins')}</span>}
        badge={
          originsForYear.length > 0 ? (
            <span className="text-[10px] tabular-nums text-slate-500">{originsForYear.length}</span>
          ) : null
        }
      >
        {originsForYear.length === 0 && !summaryQuery.isLoading ? (
          <p className={MUTED}>
            {emptyDb
              ? t('הריצו ingest כדי לראות מקורות.', 'Run ingest to see origins.')
              : t('אין מקורות לסינון הנוכחי.', 'No origins for current filter.')}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200/80 dark:border-white/10">
                  <th className="py-1 pr-2 font-bold">{t('מקור', 'Origin')}</th>
                  <th className="py-1 pr-2 text-right font-bold">{t('נפח', 'Vol')}</th>
                  <th className="py-1 text-right font-bold">{t('#', '#')}</th>
                </tr>
              </thead>
              <tbody>
                {originsForYear.map((row) => (
                  <tr key={row.origin_country} className="border-b border-slate-100/80 dark:border-white/5">
                    <td className="py-1 pr-2 font-medium text-slate-800 dark:text-slate-100 truncate max-w-[120px]">
                      {row.origin_country}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{formatBbl(row.volume_bbl)}</td>
                    <td className="py-1 text-right tabular-nums text-slate-500">{row.row_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
