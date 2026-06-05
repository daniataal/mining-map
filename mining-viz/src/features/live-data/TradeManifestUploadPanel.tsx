import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { API_BASE } from '../../lib/api';
import { toast } from 'sonner';

type Props = {
  className?: string;
};

export default function TradeManifestUploadPanel({ className = '' }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  const onUpload = async (file: File) => {
    if (!consent) {
      toast.error(
        t('נדרש אישור לשימוש בנתונים', 'Confirm you have rights to upload this data'),
      );
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('consent', 'true');
      const res = await fetch(`${API_BASE}/api/trade-manifests/upload`, {
        method: 'POST',
        body,
        credentials: 'include',
      });
      const data = (await res.json()) as { status?: string; rows_upserted?: number; message?: string };
      if (!res.ok || data.status === 'error') {
        throw new Error(data.message ?? `Upload failed (${res.status})`);
      }
      toast.success(
        t(
          `הועלו ${data.rows_upserted ?? 0} שורות (tier=user_upload)`,
          `Imported ${data.rows_upserted ?? 0} manifest rows (tier=user_upload)`,
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('העלאה נכשלה', 'Upload failed'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={`rounded-xl border border-dashed border-violet-500/35 bg-violet-500/5 p-3 ${className}`}>
      <p className="text-[9px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 mb-2">
        {t('העלאת מניפסט (CSV)', 'Manifest upload (CSV)')}
      </p>
      <p className="text-[10px] text-slate-600 dark:text-slate-400 mb-2 leading-relaxed">
        {t(
          'שורות נשמרות כ־user_upload עם provenance — לא מניפסט מכס רשמי אלא אלא אם מקורך כזה.',
          'Rows are stored as user_upload with provenance — not official customs unless your source is.',
        )}
      </p>
      <label className="flex items-start gap-2 mb-2 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-[10px] text-slate-700 dark:text-slate-300">
          {t(
            'יש לי זכות להעלות ולשתף נתונים אלה במערכת',
            'I have the right to upload and share this data in MadSan Intelligence',
          )}
        </span>
      </label>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onUpload(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/50 px-2.5 py-1.5 text-[10px] font-black uppercase text-violet-800 dark:text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {t('בחר CSV', 'Choose CSV')}
      </button>
    </div>
  );
}
