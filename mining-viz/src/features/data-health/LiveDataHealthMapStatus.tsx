import { Activity, Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OilLiveSyncStatus } from '../../api/oilLiveApi';
import {
  liveDataSyncKindChipLabel,
  liveDataSyncKindTone,
  resolveLiveDataSyncBannerKind,
} from '../live-data/liveDataSyncStatusBanner';

export type LiveDataHealthMapStatusProps = {
  syncStatus?: OilLiveSyncStatus | null;
  unreachable?: boolean;
  pending?: boolean;
  onOpenDataHealth?: () => void;
  className?: string;
};

const TONE_CLASS: Record<
  ReturnType<typeof liveDataSyncKindTone>,
  string
> = {
  ok: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100 hover:bg-emerald-500/25',
  warn: 'border-amber-500/40 bg-amber-500/15 text-amber-950 dark:text-amber-100 hover:bg-amber-500/25',
  bad: 'border-rose-500/40 bg-rose-500/15 text-rose-950 dark:text-rose-100 hover:bg-rose-500/25',
  neutral:
    'border-slate-400/40 bg-slate-500/10 text-slate-800 dark:text-slate-200 hover:bg-slate-500/20',
};

/** Compact map chip — opens Data health sidebar; full sync copy lives in DataHealthPanel. */
export function LiveDataHealthMapStatus({
  syncStatus,
  unreachable = false,
  pending = false,
  onOpenDataHealth,
  className = '',
}: LiveDataHealthMapStatusProps) {
  const { t } = useI18n();
  const kind = resolveLiveDataSyncBannerKind(syncStatus ?? undefined, { unreachable, pending });
  const chipLabel = liveDataSyncKindChipLabel(kind);
  const tone = liveDataSyncKindTone(kind);

  return (
    <button
      type="button"
      onClick={onOpenDataHealth}
      className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-wide shadow-lg backdrop-blur-md transition-colors ${TONE_CLASS[tone]} ${className}`}
      data-testid="live-data-health-chip"
      aria-label={t('פתח בריאות נתונים', 'Open data health')}
    >
      {pending ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Activity className="h-3 w-3 shrink-0" aria-hidden />
      )}
      <span>{t(chipLabel.he, chipLabel.en)}</span>
      <span className="opacity-70">·</span>
      <span className="font-bold normal-case tracking-normal">{t('פרטים', 'Details')}</span>
    </button>
  );
}
