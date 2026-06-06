import { useI18n } from '../lib/i18n';
import {
  INTELLIGENCE_MODES,
  intelligenceModeLabel,
  sublayerLabel,
  SUBLAYERS_FOR_MODE,
  type IntelligenceMode,
  type IntelligenceSublayer,
} from '../lib/intelligenceModes';
import { globalMapLens, globalMapLensHelperCopy } from '../lib/globalMapLens';
import { assetsMapLens, assetsMapLensHelperCopy } from '../lib/assetsMapLens';

type Props = {
  mode: IntelligenceMode;
  sublayer: IntelligenceSublayer;
  onModeChange: (mode: IntelligenceMode) => void;
  onSublayerChange: (sublayer: IntelligenceSublayer) => void;
  investigationsBadge?: number;
};

export function IntelligenceModeNav({
  mode,
  sublayer,
  onModeChange,
  onSublayerChange,
  investigationsBadge = 0,
}: Props) {
  const { t } = useI18n();
  const sublayers = SUBLAYERS_FOR_MODE[mode];
  const activeGlobalLens = globalMapLens(mode, sublayer);
  const activeAssetsLens = assetsMapLens(mode, sublayer);
  const lensHelper = activeGlobalLens
    ? globalMapLensHelperCopy(activeGlobalLens)
    : activeAssetsLens
      ? assetsMapLensHelperCopy(activeAssetsLens)
      : null;

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="flex gap-0.5 sm:gap-1.5 bg-stone-100/90 sm:bg-stone-100/80 dark:bg-slate-950/60 dark:sm:bg-slate-950/40 backdrop-blur-2xl p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-stone-200/90 sm:border-stone-200/70 dark:border-white/10 dark:sm:border-white/5 shadow-2xl">
        {INTELLIGENCE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${
              mode === m
                ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
            }`}
          >
            {t(intelligenceModeLabel(m), intelligenceModeLabel(m))}
            {m === 'investigations' && investigationsBadge > 0 && (
              <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                {investigationsBadge}
              </span>
            )}
          </button>
        ))}
      </div>
      {sublayers.length > 1 && (
        <div className="flex flex-wrap gap-1 justify-end max-w-[min(100%,28rem)]">
          {sublayers.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSublayerChange(s)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                sublayer === s
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  : 'border-stone-200/80 dark:border-white/10 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(sublayerLabel(s), sublayerLabel(s))}
            </button>
          ))}
        </div>
      )}
      {lensHelper && (
        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-right max-w-[min(100%,28rem)]">
          {t(lensHelper.he, lensHelper.en)}
        </p>
      )}
    </div>
  );
}
