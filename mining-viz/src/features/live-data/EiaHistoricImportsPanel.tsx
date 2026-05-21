import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, Crosshair, Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import {
  getEiaHistoricMap,
  getEiaHistoricSeries,
  getEiaHistoricSummary,
  type EiaHistoricMapArc,
} from '../../api/eiaHistoricApi';

const CARD =
  'rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm';
const LABEL = 'text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400';
const MUTED = 'text-sm leading-relaxed text-slate-700 dark:text-slate-300';

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
  const chartW = 300;
  const chartH = 64;
  const barW = Math.min(18, Math.max(4, chartW / Math.max(points.length, 1) - 2));

  return (
    <svg
      viewBox={`0 0 ${chartW} ${chartH + 14}`}
      className="w-full max-w-md h-auto text-violet-400"
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
              <text x={x + barW / 2} y={chartH + 11} textAnchor="middle" className="fill-slate-500 text-[7px]">
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
  onMapArcsChange?: (payload: { enabled: boolean; arcs: EiaHistoricMapArc[]; year: number }) => void;
};

export default function EiaHistoricImportsPanel({ onMapArcsChange }: EiaHistoricImportsPanelProps) {
  const { t } = useI18n();
  const [importer, setImporter] = useState('');
  const [importerDraft, setImporterDraft] = useState('');
  const [year, setYear] = useState(2020);
  const [showOnMap, setShowOnMap] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['eia-historic-summary', importer],
    queryFn: () => getEiaHistoricSummary({ importer: importer || undefined }),
    staleTime: 120_000,
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
    queryKey: ['eia-historic-map', year, importer],
    queryFn: () =>
      getEiaHistoricMap({
        year,
        importer: importer.trim() || undefined,
        limit: 60,
      }),
    enabled: showOnMap,
    staleTime: 120_000,
  });

  const originsForYear = useMemo(() => {
    if (!summaryQuery.data?.top_origins) return [];
    return summaryQuery.data.top_origins.slice(0, 15);
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
      year,
    });
  }, [showOnMap, mapQuery.data?.arcs, year, onMapArcsChange]);

  const topImporters = summaryQuery.data?.top_importers ?? [];
  const emptyDb = summaryQuery.data?.row_count === 0 && !summaryQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className={`${CARD} border-violet-500/30`}>
        <div className="flex items-start gap-2">
          <Archive className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t('ייבוא היסטורי (EIA)', 'Historic imports (EIA)')}
            </h3>
            <p className={`${MUTED} mt-1`}>
              {t(
                'נתוני קבצי Petroleum Supply Monthly — ברמת חברה, לא AIS חי.',
                'Petroleum Supply Monthly file data — company-level, not live AIS.',
              )}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-800 dark:text-violet-200">
              {t('ייבוא קובץ EIA · היסטורי', 'EIA file import · historic')}
            </span>
          </div>
        </div>
      </div>

      {emptyDb && (
        <div className={`${CARD} bg-amber-50/80 dark:bg-amber-950/30 border-amber-500/40`}>
          <p className={`${MUTED} text-amber-900 dark:text-amber-100`}>
            {t(
              'אין שורות ב-DB. הריצו ingest מתיקיית EIA_downloads (ראו LIVE_DATA.md).',
              'No rows in DB. Run ingest from EIA_downloads folder (see LIVE_DATA.md).',
            )}
          </p>
          <pre className="mt-2 text-[11px] text-slate-600 dark:text-slate-400 overflow-x-auto">
            {`curl -X POST "$VITE_API_BASE/api/admin/eia-historic-imports/ingest" \\
  -H "X-Admin-Token: $ADMIN_TOKEN"`}
          </pre>
        </div>
      )}

      <div className={CARD}>
        <label className={`${LABEL} block mb-2`}>{t('יבואן (חברה)', 'Importer (company)')}</label>
        <input
          type="search"
          list="eia-importer-suggestions"
          value={importerDraft}
          onChange={(e) => setImporterDraft(e.target.value)}
          onBlur={() => setImporter(importerDraft.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setImporter(importerDraft.trim());
          }}
          placeholder={t('לדוגמה Chevron', 'e.g. Chevron')}
          className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
        />
        <datalist id="eia-importer-suggestions">
          {topImporters.map((row) => (
            <option key={row.importer_name} value={row.importer_name} />
          ))}
        </datalist>
        <button
          type="button"
          className="mt-2 text-xs font-bold text-violet-600 dark:text-violet-400"
          onClick={() => setImporter(importerDraft.trim())}
        >
          {t('החל מסנן', 'Apply filter')}
        </button>
      </div>

      <div className={CARD}>
        <label className={`${LABEL} block mb-2`}>
          {t('שנה', 'Year')}: {year}
        </label>
        <input
          type="range"
          min={yearMin}
          max={yearMax}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-full accent-violet-600"
        />
        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
          <span>{yearMin}</span>
          <span>{yearMax}</span>
        </div>
        <label className="mt-3 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showOnMap}
            onChange={(e) => setShowOnMap(e.target.checked)}
            className="accent-violet-600"
          />
          <Crosshair className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('הצג במפה (קשתות סגולות)', 'Show on map (purple arcs)')}
          </span>
        </label>
        {showOnMap && mapQuery.isFetching && (
          <p className={`${MUTED} mt-2 flex items-center gap-1`}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('טוען קשתות…', 'Loading arcs…')}
          </p>
        )}
      </div>

      {summaryQuery.isLoading && (
        <p className={`${MUTED} flex items-center gap-2`}>
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('טוען סיכום…', 'Loading summary…')}
        </p>
      )}

      {importer.trim() && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>{t('נפח לאורך זמן', 'Volume over time')}</p>
          {seriesQuery.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          ) : (
            <EiaVolumeChart points={chartPoints} />
          )}
        </div>
      )}

      <div className={CARD}>
        <p className={`${LABEL} mb-2`}>
          {t('מקורות מובילים', 'Top origin countries')}
          {importer.trim() ? ` · ${importer}` : ''}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
                <th className="py-1.5 pr-2">{t('מקור', 'Origin')}</th>
                <th className="py-1.5 pr-2 text-right">{t('נפח', 'Volume')}</th>
                <th className="py-1.5 text-right">{t('שורות', 'Rows')}</th>
              </tr>
            </thead>
            <tbody>
              {originsForYear.map((row) => (
                <tr
                  key={row.origin_country}
                  className="border-b border-slate-100 dark:border-white/5"
                >
                  <td className="py-1.5 pr-2 font-medium text-slate-900 dark:text-slate-100">
                    {row.origin_country}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatBbl(row.volume_bbl)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{row.row_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summaryQuery.data?.row_count != null && (
          <p className={`${MUTED} mt-2 text-xs`}>
            {t('סה״כ שורות', 'Total rows')}: {summaryQuery.data.row_count.toLocaleString()} ·{' '}
            {t('יבואנים', 'Importers')}: {summaryQuery.data.importer_count?.toLocaleString() ?? '—'}
          </p>
        )}
      </div>
    </div>
  );
}
