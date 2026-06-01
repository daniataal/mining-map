import { memo, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OilGasLicensePopupModel, OilGasPopupRow } from '../../lib/oilGasLicensePopup';

interface OilGasLicensePopupSectionsProps {
  model: OilGasLicensePopupModel;
}

function PopupSection({
  title,
  rows,
  defaultOpen = true,
}: {
  title: string;
  rows: OilGasPopupRow[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{title}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-3 border-t border-black/5 dark:border-white/5">
          {rows.map((row) => (
            <PopupDetailCell key={`${title}-${row.label}-${row.value}`} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function PopupDetailCell({ row }: { row: OilGasPopupRow }) {
  const spanClass = row.wide ? 'col-span-2' : '';
  return (
    <div className={`min-w-0 ${spanClass}`}>
      <p className="text-[9px] font-black uppercase tracking-wide text-slate-500 mb-0.5">{row.label}</p>
      {row.href ? (
        <a
          href={row.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-start gap-1 text-[11px] font-medium text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 break-all leading-snug"
        >
          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
          {row.value}
        </a>
      ) : (
        <p className="text-[11px] font-medium text-slate-800 dark:text-slate-100 leading-snug break-words">
          {row.value}
        </p>
      )}
    </div>
  );
}

function OilGasLicensePopupSections({ model }: OilGasLicensePopupSectionsProps) {
  const { t } = useI18n();
  const operatorUnknownHint =
    model.kind === 'refinery'
      ? t('מפעיל לא מתויג', 'Operator not tagged in source')
      : t('מפעיל לא ידוע — ראה מקור', 'Operator unknown — see source');

  return (
    <div className="mt-4 space-y-2">
      {model.description && (
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 break-words px-0.5">
          {model.description}
        </p>
      )}

      {(model.kind === 'oil_field' || model.kind === 'refinery') && (
        <div className="rounded-lg border border-black/5 dark:border-white/5 px-3 py-2.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
            {t('מפעיל', 'Operator')}
          </p>
          {model.operator ? (
            <p className="text-[12px] font-medium text-slate-800 dark:text-slate-100 break-words">
              {model.operator}
            </p>
          ) : (
            <p className="text-[12px] text-slate-400 italic">{operatorUnknownHint}</p>
          )}
        </div>
      )}

      <PopupSection title={t('זהות', 'Identity')} rows={model.identity} defaultOpen />
      <PopupSection title={t('תפעול', 'Operations')} rows={model.operations} defaultOpen />
      <PopupSection title={t('מקור', 'Source')} rows={model.source} defaultOpen={false} />
    </div>
  );
}

export default memo(OilGasLicensePopupSections);
