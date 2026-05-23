import { Activity } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OilLiveSyncStatus } from '../../api/oilLiveApi';
import {
  buildLiveDataSyncTierLines,
  fmtLedgerCount,
  liveDataSyncBannerMessage,
  resolveLiveDataSyncBannerKind,
} from './liveDataSyncStatusBanner';

export type LiveDataSyncStatusBannerProps = {
  syncStatus?: OilLiveSyncStatus | null;
  unreachable?: boolean;
  pending?: boolean;
  className?: string;
};

/**
 * Compact Live Data map banner — honest tier counts + last sync from GET /api/oil-live/sync-status.
 */
export function LiveDataSyncStatusBanner({
  syncStatus,
  unreachable = false,
  pending = false,
  className = '',
}: LiveDataSyncStatusBannerProps) {
  const { t } = useI18n();
  const kind = resolveLiveDataSyncBannerKind(syncStatus ?? undefined, { unreachable, pending });
  const headline = liveDataSyncBannerMessage(kind);
  const tierLines = syncStatus ? buildLiveDataSyncTierLines(syncStatus) : [];
  const demoNote =
    syncStatus &&
    ((syncStatus.demo_port_call_count ?? 0) > 0 || (syncStatus.demo_cargo_record_count ?? 0) > 0)
      ? t(
          `דמו מוחרג מספירת ייצור (${fmtLedgerCount(syncStatus.demo_port_call_count)} קריאות נמל · ${fmtLedgerCount(syncStatus.demo_cargo_record_count)} MCR)`,
          `Demo excluded from production counts (${fmtLedgerCount(syncStatus.demo_port_call_count)} port calls · ${fmtLedgerCount(syncStatus.demo_cargo_record_count)} MCR)`,
        )
      : null;

  const tone =
    kind === 'unreachable' || kind === 'demo_only'
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-950 dark:text-rose-100'
      : kind === 'degraded' || kind === 'empty'
        ? 'border-amber-500/40 bg-amber-500/12 text-amber-950 dark:text-amber-100'
        : 'border-cyan-600/30 bg-cyan-500/10 text-cyan-950 dark:text-cyan-100';

  return (
    <div
      className={`pointer-events-auto rounded-xl border backdrop-blur-md px-3 py-2 shadow-lg max-w-[min(100vw-2rem,520px)] ${tone} ${className}`}
      role="status"
      data-testid="live-data-sync-status-banner"
    >
      <p className="text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 opacity-90">
        <Activity className="w-3 h-3 shrink-0" />
        {t('סטטוס סנכרון', 'Sync status')}
      </p>
      {headline && (
        <p className="mt-1 text-[10px] font-semibold leading-snug">{t(headline.he, headline.en)}</p>
      )}
      {tierLines.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] leading-snug">
          {tierLines.map((line) => (
            <li key={line.key} className="inline-flex items-baseline gap-1">
              <span className="font-bold uppercase tracking-wide opacity-80">
                {t(line.labelHe, line.labelEn)}:
              </span>
              <span className="font-black tabular-nums">{fmtLedgerCount(line.count)}</span>
              {line.lastSyncLabel && (
                <span className="opacity-75">
                  · {line.lastSyncLabel}
                  {line.stale ? ' ⚠' : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {demoNote && kind !== 'demo_only' && (
        <p className="mt-1 text-[9px] opacity-85 leading-snug">{demoNote}</p>
      )}
      {syncStatus?.disclaimer && kind === 'ok' && (
        <p className="mt-1 text-[9px] opacity-70 leading-snug">{syncStatus.disclaimer}</p>
      )}
    </div>
  );
}
