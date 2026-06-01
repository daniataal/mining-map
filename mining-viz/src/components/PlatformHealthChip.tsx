import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { platformHealthIssues, usePlatformHealth } from '../lib/platformHealth';

/**
 * Compact dismissible platform status — replaces the full-width error essay.
 */
export default function PlatformHealthChip() {
  const { t } = useI18n();
  const { data, isError, error, isLoading } = usePlatformHealth(true);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const issues = useMemo(() => {
    if (isError) {
      const message = error instanceof Error ? error.message : String(error);
      const warming =
        /abort|timed out|still be starting/i.test(message) ||
        (error instanceof Error && error.name === 'AbortError');
      if (warming) {
        return [
          t(
            'השרת עדיין עולה (ingest ברקע) — נסו שוב בעוד דקה',
            'Backend still starting (background ingest) — retry in a minute',
          ),
        ];
      }
      return [
        t(
          'לא ניתן להגיע ל-API',
          `Cannot reach API — start backend (port 8000). ${message.slice(0, 80)}`,
        ),
      ];
    }
    return platformHealthIssues(data);
  }, [data, error, isError, t]);

  if (dismissed || isLoading || issues.length === 0) return null;

  const primary = issues[0];
  const more = issues.length - 1;

  return (
    <div
      className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-950/90 border-b border-amber-500/30 text-amber-50 text-[11px]"
      role="status"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-black uppercase tracking-widest text-[9px] text-amber-300">
          {t('מצב', 'Status')}
        </span>
        <span className="font-semibold truncate max-w-[min(70vw,520px)]">{primary}</span>
        {more > 0 && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[10px] font-bold uppercase text-amber-200 hover:text-white"
          >
            +{more} {t('עוד', 'more')}
          </button>
        )}
        {expanded && more > 0 && (
          <ul className="w-full list-disc ps-4 text-[10px] space-y-0.5">
            {issues.slice(1).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-1 rounded hover:bg-amber-500/20"
          aria-label={expanded ? t('הסתר', 'Collapse') : t('הרחב', 'Expand')}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-amber-200/80 hover:bg-amber-500/20"
        aria-label={t('סגור', 'Dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
