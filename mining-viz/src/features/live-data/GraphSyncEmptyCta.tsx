import { useState } from 'react';
import { Terminal } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { toast } from 'sonner';

const GRAPH_SYNC_CURL = `curl -X POST "http://localhost:8000/api/admin/oil-live/graph-sync" \\
  -H "X-Admin-Token: $ADMIN_TOKEN"`;

export default function GraphSyncEmptyCta({ context }: { context: 'cargo' | 'companies' }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const label =
    context === 'cargo'
      ? t('אין רשומות מטען', 'No cargo records yet')
      : t('אין חברות מסחר', 'No companies indexed yet');

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      <p className="font-bold text-slate-900 dark:text-white">{label}</p>
      <p className="mt-1.5 text-slate-700 dark:text-slate-300">
        {t(
          'הריצו graph-sync כדי לייבא מסופים, חברות ומטען סינתטי.',
          'Run graph-sync to import terminals, companies, and synthetic cargo.',
        )}
      </p>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-white/80 px-3 py-2 text-xs font-bold uppercase tracking-wide text-amber-900 hover:bg-amber-50 dark:bg-slate-900/80 dark:text-amber-200"
        onClick={() => setExpanded((v) => !v)}
      >
        <Terminal className="h-3.5 w-3.5" />
        {expanded ? t('הסתר curl', 'Hide curl') : t('הרץ graph-sync', 'Run graph-sync')}
      </button>
      {expanded && (
        <div className="mt-2">
          <pre className="overflow-x-auto rounded-lg border border-black/10 bg-slate-950 px-3 py-2 text-[11px] leading-relaxed text-emerald-300 dark:border-white/10">
            {GRAPH_SYNC_CURL}
          </pre>
          <button
            type="button"
            className="mt-2 text-xs font-bold uppercase text-sky-600 dark:text-sky-400"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(GRAPH_SYNC_CURL);
                toast.success(t('הועתק', 'Copied'));
              } catch {
                toast.error(t('העתקה נכשלה', 'Copy failed'));
              }
            }}
          >
            {t('העתק curl', 'Copy curl')}
          </button>
        </div>
      )}
    </div>
  );
}
