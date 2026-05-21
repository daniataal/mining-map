import { useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { toast } from 'sonner';
import { API_BASE } from '../../lib/api';

type Props = {
  cargoRecordCount: number | null | undefined;
  className?: string;
};

/**
 * Floating map CTA when the synthetic cargo ledger is empty.
 */
export default function GraphSyncMapBanner({ cargoRecordCount, className = '' }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  if (cargoRecordCount == null || cargoRecordCount > 0) return null;

  const runSync = async () => {
    setBusy(true);
    try {
      const token =
        typeof localStorage !== 'undefined' ? localStorage.getItem('admin_token') ?? '' : '';
      const res = await fetch(`${API_BASE}/api/admin/oil-live/graph-sync`, {
        method: 'POST',
        headers: token ? { 'X-Admin-Token': token } : {},
      });
      const data = (await res.json()) as { status?: string; message?: string };
      if (!res.ok || data.status === 'error') {
        throw new Error(data.message ?? `Sync failed (${res.status})`);
      }
      toast.success(
        t('graph-sync הושלם — רעננו את הדף', 'Graph-sync finished — refresh the page'),
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t('נדרש ADMIN_TOKEN ב-localStorage', 'Set admin_token in localStorage or run curl'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`pointer-events-auto rounded-xl border border-amber-500/40 bg-amber-500/15 backdrop-blur-md px-3 py-2.5 shadow-lg max-w-[280px] ${className}`}
    >
      <p className="text-[10px] font-black uppercase tracking-wide text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
        <Database className="w-3.5 h-3.5" />
        {t('אין מטען במאגר', 'No cargo in database')}
      </p>
      <p className="text-[10px] text-slate-700 dark:text-slate-300 mt-1 leading-snug">
        {t(
          'הפעילו graph-sync כדי לייצא מסופים, MCR ומסדרונות.',
          'Run graph-sync to populate terminals, MCR rows, and map corridors.',
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void runSync()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[10px] font-black uppercase text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {t('הרץ graph-sync', 'Run graph-sync')}
      </button>
    </div>
  );
}
