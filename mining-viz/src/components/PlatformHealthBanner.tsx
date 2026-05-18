import { AlertTriangle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { platformHealthIssues, usePlatformHealth } from '../lib/platformHealth';

export default function PlatformHealthBanner() {
  const { t } = useI18n();
  const { data, isError, error, isLoading } = usePlatformHealth(true);
  const [dismissed, setDismissed] = useState(false);

  const issues = useMemo(() => {
    if (isError) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        t(
          'לא ניתן להגיע לשרת — הפעל docker compose up backend (פורט 8000)',
          `Cannot reach API — start backend (docker compose up backend, port 8000). ${message}`,
        ),
      ];
    }
    return platformHealthIssues(data);
  }, [data, error, isError, t]);

  if (dismissed || isLoading || issues.length === 0) return null;

  return (
    <div
      className="shrink-0 flex items-start gap-3 px-4 py-2.5 bg-amber-950/95 border-b border-amber-500/35 text-amber-50 text-[11px]"
      role="status"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="font-black uppercase tracking-widest text-[9px] text-amber-300">
          {t('מצב פלטפורמה', 'Platform status')}
        </p>
        <ul className="list-disc ps-4 space-y-0.5 font-semibold leading-snug">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        {issues.some((issue) => issue.includes('GROQ_API_KEY') || issue.includes('OPENROUTER')) && (
          <p className="text-[10px] text-amber-200/90 leading-snug pt-1">
            {t(
              'לפיתוח מקומי: העתיקו .env.example ל-.env והגדירו מפתחות AI, או השאירו DISABLE_POLLINATIONS_FALLBACK ריק כדי לאפשר fallback חינמי.',
              'Local dev: copy .env.example to .env and set GROQ_API_KEY and/or OPENROUTER_API_KEY, or leave DISABLE_POLLINATIONS_FALLBACK unset for the free fallback.',
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg p-1 text-amber-200/80 hover:bg-amber-500/20 hover:text-white"
        aria-label={t('סגור', 'Dismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
