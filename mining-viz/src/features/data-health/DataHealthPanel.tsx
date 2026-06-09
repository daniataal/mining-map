import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Database, Radio, ShieldCheck } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import {
  getOilLiveSyncStatus,
  getOilLiveSourceHealth,
  type OilLiveSourceHealth,
} from '../../api/oilLiveApi';
import type { WorldCoverageResponse } from '../../types';
import type { LicenseCoverageSector } from '../../lib/licenseCoverage';
import { LicenseCoverageBreakdown } from '../licenses/LicenseCoverageBreakdown';
import { LicenseSyncStatusBar } from '../licenses/LicenseSyncStatusBar';
import GraphSyncEmptyCta from '../live-data/GraphSyncEmptyCta';
import CustomsOpenTierBadge from '../live-data/CustomsOpenTierBadge';
import {
  buildLiveDataSyncTierLines,
  fmtLedgerCount,
  formatRelativeSyncAge,
  liveDataSyncBannerMessage,
  liveDataSyncKindChipLabel,
  liveDataSyncKindTone,
  resolveLiveDataSyncBannerKind,
} from '../live-data/liveDataSyncStatusBanner';
import { resolveLiveAisBanner } from '../live-data/liveAisBanner';
import { usePlatformHealth } from '../../lib/platformHealth';

const LABEL = 'text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400';
const CARD =
  'rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-4 shadow-sm';

const KIND_BADGE: Record<
  ReturnType<typeof liveDataSyncKindTone>,
  string
> = {
  ok: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-100',
  warn: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100',
  bad: 'border-rose-500/40 bg-rose-500/15 text-rose-950 dark:text-rose-100',
  neutral: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-200',
};

export type DataHealthPanelProps = {
  worldCoverage?: WorldCoverageResponse | null;
  licenseCoverageSector?: LicenseCoverageSector | null;
  licenseCoverageAlsoShowSector?: LicenseCoverageSector | null;
  coverageStats?: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
  } | null;
};

export default function DataHealthPanel({
  worldCoverage,
  licenseCoverageSector,
  licenseCoverageAlsoShowSector,
  coverageStats,
}: DataHealthPanelProps) {
  const { t } = useI18n();

  const {
    data: syncStatus,
    isError: syncStatusError,
    error: syncStatusErr,
    isPending: syncStatusPending,
  } = useQuery({
    queryKey: ['oil-live-sync-status'],
    queryFn: getOilLiveSyncStatus,
    staleTime: 45_000,
    refetchInterval: 120_000,
  });

  const { data: sourceHealthData } = useQuery({
    queryKey: ['oil-live-source-health'],
    queryFn: getOilLiveSourceHealth,
    staleTime: 60_000,
  });

  const { data: platformHealth } = usePlatformHealth(true);

  const syncStatusUnreachable = syncStatusError && !syncStatus;
  const syncStatusErrorMessage =
    syncStatusErr instanceof Error ? syncStatusErr.message : syncStatusErr ? String(syncStatusErr) : null;

  const kind = resolveLiveDataSyncBannerKind(syncStatus ?? undefined, {
    unreachable: syncStatusUnreachable,
    pending: syncStatusPending,
  });
  const headline = liveDataSyncBannerMessage(kind);
  const chipLabel = liveDataSyncKindChipLabel(kind);
  const tone = liveDataSyncKindTone(kind);
  const tierLines = syncStatus ? buildLiveDataSyncTierLines(syncStatus) : [];

  const liveAisBanner = useMemo(
    () =>
      resolveLiveAisBanner(syncStatus, {
        vesselsInView: coverageStats?.vessels ?? 0,
        platformHealth,
      }),
    [syncStatus, coverageStats?.vessels, platformHealth],
  );

  const maritimeSourceHealth = useMemo<OilLiveSourceHealth[]>(
    () => (sourceHealthData?.sources ?? []).slice(0, 6),
    [sourceHealthData?.sources],
  );

  const demoNote =
    syncStatus &&
    ((syncStatus.demo_port_call_count ?? 0) > 0 || (syncStatus.demo_cargo_record_count ?? 0) > 0)
      ? t(
          `דמו מוחרג מספירת ייצור (${fmtLedgerCount(syncStatus.demo_port_call_count)} קריאות נמל · ${fmtLedgerCount(syncStatus.demo_cargo_record_count)} MCR)`,
          `Demo excluded from production counts (${fmtLedgerCount(syncStatus.demo_port_call_count)} port calls · ${fmtLedgerCount(syncStatus.demo_cargo_record_count)} MCR)`,
        )
      : null;

  const macroSources = useMemo(() => {
    if (!syncStatus) return [];
    const rows: Array<{ key: string; label: string; status: string | null; age: string | null }> = [];
    const push = (key: string, label: string, status: string | null | undefined, iso: string | null | undefined) => {
      rows.push({
        key,
        label,
        status: status ?? null,
        age: formatRelativeSyncAge(iso),
      });
    };
    push('comtrade', 'Comtrade', syncStatus.last_comtrade_sync_status, syncStatus.last_comtrade_sync_at);
    push('eurostat', 'Eurostat', syncStatus.last_eurostat_sync_status, syncStatus.last_eurostat_sync_at);
    push('jodi', 'JODI', syncStatus.last_jodi_sync_status, syncStatus.last_jodi_sync_at);
    return rows.filter((r) => r.status != null || r.age != null);
  }, [syncStatus]);

  const showGulfSparseNote =
    (syncStatus?.coverage_gap_watch_zone_count ?? 0) > 0 ||
    Boolean(syncStatus?.watch_zone_observations_24h?.some((z) => z.has_gap));

  const showLicenseSection =
    licenseCoverageSector != null &&
    (worldCoverage != null || licenseCoverageSector === 'mining' || licenseCoverageSector === 'oil_and_gas');

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto p-3 space-y-3"
      data-testid="data-health-panel"
    >
      <div className="space-y-1">
        <p className={`${LABEL} flex items-center gap-1.5 text-amber-700 dark:text-amber-300`}>
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('בריאות נתונים', 'Data health')}
        </p>
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {t(
            'שקיפות כנות — כיסוי רישיונות, שכבות חיות ומאגר. לא מסתיר מצבי דמו או כיסוי דליל.',
            'Honest coverage transparency — licenses, live layers, and ledger tiers. Demo and sparse states stay visible.',
          )}
        </p>
      </div>

      <div className={`${CARD} space-y-2`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`${LABEL} flex items-center gap-1.5`}>
            <Activity className="h-3.5 w-3.5" />
            {t('סטטוס מאגר חי', 'Live ledger status')}
          </p>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase ${KIND_BADGE[tone]}`}
          >
            {t(chipLabel.he, chipLabel.en)}
          </span>
        </div>
        {headline && (
          <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
            {t(headline.he, headline.en)}
          </p>
        )}
        {syncStatusUnreachable && (
          <p
            className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-2 text-xs leading-relaxed text-rose-950 dark:text-rose-100"
            role="alert"
          >
            {t(
              'לא ניתן להגיע ל-oil-live-intel (/api/oil-live/sync-status). ודאו שהקונטיינר רץ והדפדפן פונה דרך Caddy :8080.',
              'Cannot reach oil-live-intel (/api/oil-live/sync-status). Ensure the container is running and the browser uses Caddy :8080.',
            )}
            {syncStatusErrorMessage ? ` (${syncStatusErrorMessage})` : ''}
          </p>
        )}
        {liveAisBanner.kind !== 'none' &&
          liveAisBanner.kind !== 'tls_expired' &&
          liveAisBanner.kind !== 'worker_error' && (
            <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              {t(liveAisBanner.messageHe, liveAisBanner.messageEn)}
            </p>
          )}
        {showGulfSparseNote && (
          <p className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 py-2 text-xs leading-relaxed text-sky-950 dark:text-sky-100">
            {t(
              'AIS פתוח דליל במפרץ הפרסי — מפה ריקה לא אומרת שאין תנועה. הפעילו שכבת כיסוי AIS או oil-live-intel-worker; נתוני הדגמה כבויים.',
              'Open AIS is sparse in the Persian Gulf — empty map does not mean no traffic. Enable AIS coverage layer or run oil-live-intel-worker; demo seeds are off.',
            )}
          </p>
        )}
        {demoNote && kind !== 'demo_only' && (
          <p className="text-xs text-slate-600 dark:text-slate-400">{demoNote}</p>
        )}
      </div>

      {tierLines.length > 0 && (
        <div className={`${CARD} space-y-3`}>
          <p className={`${LABEL} flex items-center gap-1.5`}>
            <Database className="h-3.5 w-3.5" />
            {t('שכבות מאגר', 'Ledger tiers')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {tierLines.map((line) => (
              <div
                key={line.key}
                className={`rounded-lg border px-2.5 py-2 ${
                  line.stale
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/50'
                }`}
              >
                <p className="text-lg font-black tabular-nums leading-none text-slate-900 dark:text-slate-50">
                  {fmtLedgerCount(line.count)}
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  {t(line.labelHe, line.labelEn)}
                </p>
                {line.lastSyncLabel && (
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {t('עודכן', 'Updated')} {line.lastSyncLabel}
                    {line.stale ? ` · ${t('דליל', 'sparse')}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
          {(syncStatus?.trade_manifest_row_count ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <CustomsOpenTierBadge tier="customs_open" className="text-[9px]" />
              <p className="text-[10px] text-slate-600 dark:text-slate-400">
                {t(
                  'מניפסטים פתוחים — לא BOL בתשלום.',
                  'Open manifests — not paid BOL.',
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {macroSources.length > 0 && (
        <div className={`${CARD} space-y-2`}>
          <p className={LABEL}>{t('מקורות מאקרו', 'Macro sources')}</p>
          <ul className="space-y-1.5">
            {macroSources.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs"
              >
                <span className="font-bold text-slate-800 dark:text-slate-200">{row.label}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {row.status && row.status !== 'ok' ? (
                    <span className="text-amber-700 dark:text-amber-300">{row.status}</span>
                  ) : (
                    t('תקין', 'ok')
                  )}
                  {row.age ? ` · ${row.age}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(syncStatus?.graph_sync_steps?.length ?? 0) > 0 && (
        <div className={`${CARD} space-y-2`}>
          <p className={LABEL}>{t('שלבי graph-sync אחרונים', 'Recent graph-sync steps')}</p>
          <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
            {syncStatus!.graph_sync_steps!.slice(0, 8).map((s) => (
              <li key={s.key} className="flex justify-between gap-2">
                <span className="truncate font-mono text-[10px]">
                  {s.key.replace(/^graph_sync_step_|^graphsync_/, '')}
                </span>
                <span
                  className={`shrink-0 font-bold uppercase ${
                    s.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(syncStatus?.watch_zone_observations_24h?.length ?? 0) > 0 && (
        <div className={`${CARD} space-y-2`}>
          <p className={`${LABEL} flex items-center gap-1.5`}>
            <Radio className="h-3.5 w-3.5" />
            {t('כיסוי AIS לפי אזור (24ש)', 'AIS by watch zone (24h)')}
          </p>
          <ul className="max-h-36 overflow-y-auto space-y-1 text-xs">
            {syncStatus!.watch_zone_observations_24h!.map((z) => (
              <li key={z.zone_id} className="flex justify-between gap-2 text-slate-700 dark:text-slate-300">
                <span className="truncate">{z.name}</span>
                <span className="shrink-0 tabular-nums">
                  {z.observation_count}
                  {z.has_gap ? ` · ${t('פער', 'gap')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {maritimeSourceHealth.length > 0 && (
        <div className={`${CARD} space-y-2`}>
          <p className={LABEL}>{t('בריאות מקור AIS', 'AIS source health')}</p>
          <div className="flex flex-wrap gap-1.5">
            {maritimeSourceHealth.map((source) => (
              <span
                key={source.source}
                className="rounded-full border border-cyan-700/20 bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase text-cyan-950 dark:border-cyan-300/20 dark:bg-cyan-950/40 dark:text-cyan-100"
              >
                {source.source}
                {source.status ? ` · ${source.status}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {(syncStatus?.production_cargo_record_count ?? syncStatus?.cargo_record_count ?? 0) === 0 &&
        !syncStatusPending &&
        !syncStatusUnreachable && (
          <GraphSyncEmptyCta context="cargo" />
        )}

      {showLicenseSection && licenseCoverageSector && (
        <div className="space-y-3">
          <LicenseCoverageBreakdown
            sector={licenseCoverageSector}
            worldCoverage={worldCoverage}
            alsoShowSector={licenseCoverageAlsoShowSector}
          />
          {licenseCoverageSector === 'mining' && (
            <LicenseSyncStatusBar worldCoverage={worldCoverage} />
          )}
        </div>
      )}

      {coverageStats && (
        <div className={`${CARD} space-y-2`}>
          <p className={LABEL}>{t('בתצוגת המפה הנוכחית', 'In current map view')}</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['terminals', t('מסופים', 'Terminals'), coverageStats.terminals],
                ['vessels', t('כלי שיט', 'Vessels'), coverageStats.vessels],
                ['opportunities', t('הזדמנויות', 'Opportunities'), coverageStats.opportunities],
                ['corridors', t('מסדרונות', 'Corridors'), coverageStats.corridors],
              ] as const
            ).map(([key, label, value]) => (
              <div
                key={key}
                className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/50 px-2.5 py-2 text-center"
              >
                <p className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
                <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${CARD} flex gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400`}>
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" aria-hidden />
        <p>
          {syncStatus?.disclaimer ??
            t(
              'מקורות: OSM, AIS פתוח, Comtrade, TED, רישיונות — חוסר AIS מסומן כפער כיסוי, לא כאין פעילות.',
              'Sources: OSM, open AIS, Comtrade, TED, licenses — missing AIS is a coverage gap, not proof of no activity.',
            )}
        </p>
      </div>
    </div>
  );
}
