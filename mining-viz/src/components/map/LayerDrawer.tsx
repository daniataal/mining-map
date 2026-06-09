import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Radar, Ship } from 'lucide-react';
import { Button } from '../ui/button';
type TranslateFn = (he: string, en: string) => string;

type LayerDrawerProps = {
  t: TranslateFn;
  isMaritimeLayerEnabled: boolean;
  isMaritimeLoading: boolean;
  hasMaritimeFeed: boolean;
  maritimeIdleHint: string;
  onToggleLayer: () => void;
  children?: ReactNode;
  defaultExpanded?: boolean;
};

export default function LayerDrawer({
  t,
  isMaritimeLayerEnabled,
  isMaritimeLoading,
  hasMaritimeFeed,
  maritimeIdleHint,
  onToggleLayer,
  children,
  defaultExpanded = false,
}: LayerDrawerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="absolute left-4 bottom-4 z-[950] w-[min(100vw-2rem,480px)] rounded-2xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2.5 border-b border-black/5 px-3.5 py-3 dark:border-white/5 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10">
          <Radar className="h-4 w-4 text-cyan-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-500">
            {t('מעקב ימי', 'Maritime Watch')}
          </p>
          <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            AIS: {isMaritimeLayerEnabled ? t('פעיל', 'On') : t('כבוי', 'Off')}
          </p>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {!expanded && (
        <div className="px-3.5 py-3">
          <Button
            type="button"
            onClick={onToggleLayer}
            className={`h-10 w-full rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
              isMaritimeLayerEnabled
                ? 'border border-black/10 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
            }`}
          >
            {isMaritimeLayerEnabled && isMaritimeLoading && !hasMaritimeFeed ? (
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Ship className="mr-2 h-4 w-4 inline" />
            )}
            {isMaritimeLayerEnabled
              ? t('כבה שכבת כלי שיט', 'Turn off vessel layer')
              : t('הפעל שכבת ימית', 'Activate Maritime Layer')}
          </Button>
          {!isMaritimeLayerEnabled && (
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              {maritimeIdleHint}
            </p>
          )}
        </div>
      )}

      {expanded && (
        <div className="space-y-3 px-3.5 pb-3.5 pt-3">
          <Button
            type="button"
            onClick={onToggleLayer}
            className={`h-10 w-full rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
              isMaritimeLayerEnabled
                ? 'border border-black/10 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
            }`}
          >
            <Ship className="mr-2 h-4 w-4 inline" />
            {isMaritimeLayerEnabled
              ? t('הסתר תנועת מכליות', 'Hide Tanker Movement')
              : t('הצג תנועת מכליות', 'Show Tanker Movement')}
          </Button>
          {children}
        </div>
      )}
    </div>
  );
}
