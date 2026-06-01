import type { ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

export type ShipVaultSlideOverProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
};

/** Nested slide-over inside maritime drawer (company / yard). */
export default function ShipVaultSlideOver({
  title,
  subtitle,
  onClose,
  onBack,
  children,
}: ShipVaultSlideOverProps) {
  const { t } = useI18n();
  return (
    <div
      className="shipvault-slide-over absolute inset-0 z-20 flex flex-col rounded-2xl border border-violet-500/30 bg-stone-50/98 dark:bg-slate-950/98 shadow-xl"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-2 border-b border-black/5 dark:border-white/10 px-4 py-3 shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="h-8 w-8 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"
            aria-label={t('חזרה', 'Back')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-widest text-violet-400">ShipVault</p>
          <h4 className="text-sm font-black text-slate-900 dark:text-white truncate">{title}</h4>
          {subtitle && <p className="text-[10px] text-slate-500 truncate">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 shrink-0 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"
          aria-label={t('סגור', 'Close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">{children}</div>
    </div>
  );
}
