import { Loader2, Radar, Ship } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { MaritimeTankerView, OilAndGasDisplayMode } from '../../types';
import type { ReactNode } from 'react';

type TranslateFn = (he: string, en: string) => string;

type MaritimeControlPanelProps = {
  t: TranslateFn;
  isMaritimeLayerEnabled: boolean;
  isMaritimeLoading: boolean;
  hasMaritimeFeed: boolean;
  maritimeIdleHint: string;
  oilAndGasDisplayMode: OilAndGasDisplayMode;
  onOilAndGasDisplayModeChange: (value: OilAndGasDisplayMode) => void;
  hideCountryBordersForVesselsOnly: boolean;
  maritimeTankerView: MaritimeTankerView;
  tankerViewOptions: { value: MaritimeTankerView; labelHe: string; labelEn: string }[];
  onMaritimeTankerViewChange: (value: MaritimeTankerView) => void;
  onToggleLayer: () => void;
  onFocusOilTerminals: () => void;
  children?: ReactNode;
  /** When true, render body only (for LayerDrawer shell). */
  embedded?: boolean;
  hideToggle?: boolean;
};

export default function MaritimeControlPanel({
  t,
  isMaritimeLayerEnabled,
  isMaritimeLoading,
  hasMaritimeFeed,
  maritimeIdleHint,
  oilAndGasDisplayMode,
  onOilAndGasDisplayModeChange,
  hideCountryBordersForVesselsOnly,
  maritimeTankerView,
  tankerViewOptions,
  onMaritimeTankerViewChange,
  onToggleLayer,
  onFocusOilTerminals,
  children,
  embedded = false,
  hideToggle = false,
}: MaritimeControlPanelProps) {
  const body = (
      <div className={embedded ? 'space-y-3' : 'space-y-3 px-3.5 pb-3.5 pt-3'}>
        {!hideToggle && (
          <Button
            type="button"
            onClick={onToggleLayer}
            className={`h-10 w-full rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
              isMaritimeLayerEnabled
                ? 'border border-black/10 bg-slate-900 text-white hover:bg-slate-800 dark:border-white/10 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100'
                : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
            }`}
          >
            {isMaritimeLayerEnabled && isMaritimeLoading && !hasMaritimeFeed ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Ship className="mr-2 h-4 w-4" />
            )}
            {isMaritimeLayerEnabled
              ? t('כבה שכבת כלי שיט', 'Turn off vessel layer')
              : t('הפעל שכבת ימית', 'Activate Maritime Layer')}
          </Button>
        )}

        {!hideToggle && !isMaritimeLayerEnabled && (
          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{maritimeIdleHint}</p>
        )}

        <div>
          <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
            {t('תצוגה', 'Display')}
          </p>
          <Select value={oilAndGasDisplayMode} onValueChange={(value) => onOilAndGasDisplayModeChange(value as OilAndGasDisplayMode)}>
            <SelectTrigger className="h-9 w-full rounded-xl border-black/10 bg-white/80 text-[10px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
              <SelectItem value="combined">{t('משולב', 'Combined')}</SelectItem>
              <SelectItem value="vessels_only">{t('כלי שיט בלבד', 'Vessels only')}</SelectItem>
              <SelectItem value="on_ground_only">{t('קרקע בלבד', 'On-ground only')}</SelectItem>
            </SelectContent>
          </Select>
          {hideCountryBordersForVesselsOnly && (
            <p className="mt-1.5 text-[9px] leading-snug text-slate-500 dark:text-slate-500">
              {t(
                'גבולות מדינות מוסתרים במצב זה לתצוגה ימית נקייה. חזרו למשולב או קרקע כדי להציג שוב.',
                'Country borders stay hidden in this mode for a cleaner sea view. Switch to Combined or On-ground to show them again.',
              )}
            </p>
          )}
        </div>

        <div>
          <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-slate-500">
            {t('שכבת כלי שיט', 'Vessel Layer')}
          </p>
          <Select value={maritimeTankerView} onValueChange={(value) => onMaritimeTankerViewChange(value as MaritimeTankerView)}>
            <SelectTrigger className="h-9 w-full rounded-xl border-black/10 bg-white/80 text-[10px] font-black uppercase tracking-widest dark:border-white/10 dark:bg-slate-950/80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-black/10 bg-white dark:border-white/10 dark:bg-slate-950">
              {tankerViewOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelHe, option.labelEn)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge className="border-none bg-cyan-500/10 text-[8px] font-black uppercase text-cyan-600 dark:text-cyan-300">
              {t('מכליות בלבד', 'Tankers only')}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onFocusOilTerminals}
              className="h-7 rounded-lg px-2 text-[8px] font-black uppercase tracking-widest text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400"
            >
              {t('מסופי נפט', 'Oil Terminals')}
            </Button>
          </div>
          <p className="mt-1.5 text-[9px] leading-snug text-slate-500 dark:text-slate-500">
            {maritimeTankerView === 'worldwide'
              ? t(
                  'קורא מכליות שמורות מכל העולם; בחירת תצוגה לא משנה את ה-worker.',
                  'Reads stored worldwide tankers; changing view never changes the collector.',
                )
              : t(
                  'קורא מכליות שמורות באזור הנבחר ומקרב את המפה לשם.',
                  'Reads stored tankers in the selected region and flies the map there.',
                )}
          </p>
        </div>

        {children}
      </div>
  );

  if (embedded) return body;

  return (
    <div className="absolute left-4 bottom-4 z-[950] w-[min(100vw-2rem,480px)] rounded-2xl border border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl shadow-2xl">
      <div className="border-b border-black/5 px-3.5 py-3 dark:border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10">
            <Radar className="h-4 w-4 text-cyan-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-500">
              {t('מעקב ימי', 'Maritime Watch')}
            </p>
            <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              {t('AIS לפי גבולות המפה', 'AIS for current map bounds')}
            </p>
          </div>
        </div>
      </div>
      {body}
    </div>
  );
}
