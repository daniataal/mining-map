import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n';
import { fetchLicenseOpenDataSyncRuns } from '../../api/licenseSyncApi';
import {
  formatSyncTimestamp,
  latestSyncForSources,
  miningSourceIds,
} from '../../lib/licenseCoverage';
import type { WorldCoverageResponse } from '../../types';

export type LicenseSyncStatusBarProps = {
  enabled?: boolean;
  worldCoverage?: WorldCoverageResponse | null;
};

/** Sidebar ingest health — latest mining open-data sync when API is available. */
export function LicenseSyncStatusBar({ enabled = true, worldCoverage }: LicenseSyncStatusBarProps) {
  const { t } = useI18n();
  const miningIds = miningSourceIds(worldCoverage);

  const { data: runs, isError, isPending } = useQuery({
    queryKey: ['license-open-data-sync-runs'],
    queryFn: fetchLicenseOpenDataSyncRuns,
    enabled: enabled && miningIds.size > 0,
    staleTime: 60_000,
    retry: 1,
  });

  const latest = latestSyncForSources(runs, miningIds);
  const lastLabel = formatSyncTimestamp(latest?.finished_at || latest?.started_at);

  if (!enabled) return null;

  if (miningIds.size === 0) {
    return (
      <p
        className="text-[9px] text-slate-500 leading-relaxed"
        data-testid="license-sync-status"
      >
        {t(
          'סטטוס סנכרון יוצג לאחר שמקורות כרייה רשומים בקטלוג הכיסוי.',
          'Sync status appears once mining sources are listed in the coverage catalog.',
        )}
      </p>
    );
  }

  if (isPending) {
    return (
      <p className="text-[9px] text-slate-500" data-testid="license-sync-status">
        {t('טוען סטטוס סנכרון…', 'Loading sync status…')}
      </p>
    );
  }

  if (isError || !latest || !lastLabel) {
    return (
      <p
        className="text-[9px] text-amber-700 dark:text-amber-300 leading-relaxed"
        data-testid="license-sync-status"
      >
        {t(
          'אין עדיין סנכרון רשום למקורות כרייה — הריצו POST /api/admin/open-data/sync.',
          'No logged mining ingest yet — run POST /api/admin/open-data/sync.',
        )}
      </p>
    );
  }

  const status = latest.status?.toLowerCase() ?? 'unknown';
  const statusOk = status === 'success' || status === 'ok';

  return (
    <div
      className="rounded-xl border border-black/5 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-2 space-y-0.5"
      data-testid="license-sync-status"
    >
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
        {t('סנכרון אחרון', 'Last ingest')}
      </p>
      <p className="text-[10px] font-semibold text-slate-800 dark:text-slate-200">{lastLabel}</p>
      <p className="text-[9px] text-slate-500 truncate" title={latest.source_id ?? undefined}>
        {latest.source_id}
        {!statusOk && latest.status ? ` · ${latest.status}` : ''}
      </p>
    </div>
  );
}
