import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '../../lib/i18n';
import {
  COVERAGE_STATUS_LABELS,
  countriesForSector,
  formatCoverageSummaryCounts,
  sectorCoverageSummary,
  type LicenseCoverageSector,
} from '../../lib/licenseCoverage';
import type { CoverageStatus, WorldCoverageResponse } from '../../types';

const STATUS_CLASS: Record<CoverageStatus, string> = {
  official_syncable: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  global_fallback_only: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  official_api_restricted: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  official_portal_only: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  decommissioned: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  unavailable: 'bg-slate-500/10 text-slate-500',
};

export type LicenseCoverageBreakdownProps = {
  sector: LicenseCoverageSector;
  worldCoverage?: WorldCoverageResponse | null;
  /** When set (Global tab), show a compact oil summary line under mining. */
  alsoShowSector?: LicenseCoverageSector | null;
};

function SectorBlock({
  sector,
  worldCoverage,
  compact,
}: {
  sector: LicenseCoverageSector;
  worldCoverage?: WorldCoverageResponse | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const summary = sectorCoverageSummary(worldCoverage, sector);
  const summaryLine = formatCoverageSummaryCounts(summary);
  const jurisdictions = useMemo(
    () => countriesForSector(worldCoverage, sector, compact ? 6 : 10),
    [worldCoverage, sector, compact],
  );
  const sectorLabel =
    sector === 'mining' ? t('כרייה', 'Mining') : t('נפט וגז', 'Oil & gas');

  if (!summaryLine && jurisdictions.length === 0) {
    return (
      <p className="text-[10px] text-slate-500 leading-relaxed">
        {t(
          'אין עדיין מטא-נתוני כיסוי לסקטור זה — הריצו ingest או סנכרון רישיונות.',
          'No coverage metadata for this sector yet — run license ingest or open-data sync.',
        )}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{sectorLabel}</p>
      {summaryLine && (
        <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 leading-snug">
          {summaryLine}
        </p>
      )}
      {jurisdictions.length > 0 && (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          {jurisdictions.map(({ country, coverage }) => {
            const status = (coverage.status || 'unavailable') as CoverageStatus;
            const count =
              (coverage.record_count ?? 0) +
              (coverage.global_fallback_record_count ?? 0) +
              (coverage.fallback_record_count ?? 0);
            return (
              <li
                key={`${sector}-${country}`}
                className="flex items-center justify-between gap-2 text-[10px]"
              >
                <span className="truncate font-bold text-slate-700 dark:text-slate-200">{country}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {count > 0 && (
                    <span className="font-mono text-slate-500">{count.toLocaleString()}</span>
                  )}
                  <Badge
                    className={`border-none text-[8px] font-black uppercase px-1.5 h-4 ${STATUS_CLASS[status] ?? STATUS_CLASS.unavailable}`}
                  >
                    {COVERAGE_STATUS_LABELS[status] ?? status}
                  </Badge>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Per-jurisdiction license coverage (honest tiers) for map sidebar. */
export function LicenseCoverageBreakdown({
  sector,
  worldCoverage,
  alsoShowSector,
}: LicenseCoverageBreakdownProps) {
  const { t } = useI18n();
  const generatedLabel = worldCoverage?.generated_at
    ? new Date(worldCoverage.generated_at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <div
      className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-3 space-y-3"
      data-testid="license-coverage-breakdown"
    >
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
          {t('כיסוי רישיונות', 'License coverage')}
        </p>
        {generatedLabel && (
          <p className="text-[9px] text-slate-500 mt-0.5">
            {t('קטלוג', 'Catalog')}: {generatedLabel}
          </p>
        )}
      </div>
      <SectorBlock sector={sector} worldCoverage={worldCoverage} />
      {alsoShowSector && alsoShowSector !== sector && (
        <div className="pt-2 border-t border-black/5 dark:border-white/5">
          <SectorBlock sector={alsoShowSector} worldCoverage={worldCoverage} compact />
        </div>
      )}
    </div>
  );
}
