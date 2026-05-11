import { useState, useRef } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { bulkImportLicensesFile, API_BASE, type LicenseImportApiError } from '../lib/api';

interface BulkImportLicensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (importedCount: number) => void;
}

export default function BulkImportLicensesModal({ isOpen, onClose, onSuccess }: BulkImportLicensesModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<LicenseImportApiError[]>([]);
  const [lastFileName, setLastFileName] = useState<string | null>(null);

  const templateUrl = `${API_BASE}/licenses/template`;

  const reset = () => {
    setErrors([]);
    setLastFileName(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setLastFileName(file.name);
    setErrors([]);
    setBusy(true);
    try {
      const result = await bulkImportLicensesFile(file);
      if (result.ok) {
        onSuccess(result.importedCount);
        reset();
        onClose();
        return;
      }
      setErrors(result.errors);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrors([{ row: 0, message: msg }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-amber-500">
            {t('ייבוא רישיונות מקובץ', 'Bulk import licenses (CSV)')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
          <p>
            {t(
              'שורת כותרת חובה; שדות חובה: company, country, lat, lng.',
              'Header row required. Required fields: company, country, lat, lng.'
            )}
          </p>
          <p>
            {t(
              'העלאה מייבאת את כל השורות או לא מייבאת כלום—שגיאה אחת עוצרת את כל הריצה.',
              'Import is all-or-nothing: one invalid row cancels the entire upload.'
            )}
          </p>
          <ul className="list-disc ms-4 space-y-1 text-slate-500">
            <li>
              <a href={templateUrl} className="text-amber-400 hover:underline" target="_blank" rel="noreferrer">
                {t('הורד תבנית מהשרת', 'Download template (API)')}
              </a>
            </li>
            <li>
              <a
                href="/licenses-import-template.csv"
                className="text-amber-400 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {t('תבנית סטטית (אותו פורמט)', 'Static template (same format)')}
              </a>
            </li>
          <p className="text-[10px] text-slate-600">
            {t('תיעוד מלא: קובץ', 'Full reference: file')} LICENSE_BULK_IMPORT.md {t('בשורש הפרויקט', 'at repository root')}.
          </p>
          </ul>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />

        {lastFileName && (
          <p className="text-[10px] font-mono text-slate-500 truncate">{lastFileName}</p>
        )}

        {errors.length > 0 && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 max-h-40 overflow-y-auto">
            <p className="text-[10px] font-black uppercase text-red-300 mb-2">
              {t('שגיאות אימות', 'Validation errors')}
            </p>
            <ul className="space-y-1 text-[11px] text-red-200/90">
              {errors.map((err, i) => (
                <li key={i}>
                  {err.row > 0 ? `${t('שורה', 'Line')} ${err.row}: ` : ''}
                  {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={handleClose} className="text-slate-400 hover:text-slate-100">
            {t('סגור', 'Close')}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
            onClick={() => fileRef.current?.click()}
          >
            {busy ? t('מייבא…', 'Importing…') : t('בחר קובץ CSV', 'Choose CSV file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
