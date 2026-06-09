import { Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { stsInferenceDisclaimer } from '../../api/stsEventsApi';
import type { StsEventsSummaryResponse } from '../../api/stsEventsApi';

export type StsEventsMapStatusProps = {
  enabled: boolean;
  summary?: StsEventsSummaryResponse | null;
  pending?: boolean;
  className?: string;
};

/** Map banner when STS proximity layer is on — honest count + circle vs chevron hint. */
export default function StsEventsMapStatus({
  enabled,
  summary,
  pending = false,
  className = '',
}: StsEventsMapStatusProps) {
  const { t } = useI18n();

  if (!enabled) return null;

  const count = summary?.count ?? null;
  const disclaimerText = stsInferenceDisclaimer(summary?.disclaimer);
  const empty = count === 0;

  return (
    <div
      className={`pointer-events-none rounded-2xl border border-violet-500/35 bg-violet-500/12 px-4 py-2.5 text-[10px] font-semibold leading-snug text-violet-950 shadow-lg dark:text-violet-50 ${className}`}
      role="status"
      aria-live="polite"
    >
      <p className="font-black uppercase tracking-widest text-[9px] text-violet-700 dark:text-violet-200">
        {t('קרבת STS מסקנית', 'Inferred STS proximity')}
      </p>
      {pending && count == null ? (
        <p className="mt-1 inline-flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {t('טוען סיכום…', 'Loading summary…')}
        </p>
      ) : empty ? (
        <p className="mt-1">
          {t(
            'אין STS מסקני בתצוגה — הזיזו/התקרבו או המתינו לסריקה הבאה (~30 דק׳)',
            'No inferred STS in this view — pan/zoom or wait for next scan (~30m)',
          )}
        </p>
      ) : (
        <p className="mt-1">
          {t(
            `${count!.toLocaleString()} STS מסקניים בתצוגה · עיגולים מלאים, לא סימני כלי שיט`,
            `${count!.toLocaleString()} inferred STS in view · filled circles, not vessel chevrons`,
          )}
        </p>
      )}
      {!empty && (
        <p className="mt-1 text-[9px] opacity-85">{disclaimerText}</p>
      )}
    </div>
  );
}
