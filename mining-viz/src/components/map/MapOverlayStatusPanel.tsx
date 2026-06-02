type TranslateFn = (he: string, en: string) => string;

type MapOverlayStatusPanelProps = {
  t: TranslateFn;
  licensesFetchPending: boolean;
  licensesRefetching: boolean;
  licensesSecondaryStatus: string | null;
  licenseMarkersCapped: boolean;
  licenseMapDomMarkerCap: number;
  showWorldCountrySummaryNotice: boolean;
  borderCountriesCapped: boolean;
  borderGeoJsonMatchesMarkers: boolean;
  borderCountryCap: number;
};

export default function MapOverlayStatusPanel({
  t,
  licensesFetchPending,
  licensesRefetching,
  licensesSecondaryStatus,
  licenseMarkersCapped,
  licenseMapDomMarkerCap,
  showWorldCountrySummaryNotice,
  borderCountriesCapped,
  borderGeoJsonMatchesMarkers,
  borderCountryCap,
}: MapOverlayStatusPanelProps) {
  return (
    <>
      {licensesFetchPending && (
        <div
          className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-white/30 dark:bg-slate-950/35 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white/90 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-xl dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-200">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden />
            <span>{t('טוען רישיונות…', 'Loading licenses…')}</span>
          </div>
        </div>
      )}
      {licensesRefetching && !licensesFetchPending && (
        <div
          className="pointer-events-none absolute left-1/2 top-20 z-[600] flex -translate-x-1/2 items-center gap-2 rounded-full border border-black/10 bg-white/90 px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-600 shadow-lg dark:border-white/10 dark:bg-slate-900/90 dark:text-slate-300"
          role="status"
          aria-live="polite"
        >
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden />
          <span>{t('מעדכן רישיונות…', 'Updating licenses…')}</span>
        </div>
      )}
      {licensesSecondaryStatus && (
        <div
          className="pointer-events-none absolute left-1/2 top-32 z-[600] max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-center text-[9px] font-bold uppercase tracking-wide text-amber-900 shadow-md dark:border-amber-400/20 dark:bg-amber-500/15 dark:text-amber-100"
          role="status"
          aria-live="polite"
        >
          {licensesSecondaryStatus}
        </div>
      )}
      {licenseMarkersCapped && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-slate-950/85 text-slate-100 border border-cyan-500/20 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 text-center">
            {t('מגבלת סימנים לביצועים', 'Marker limit for performance')}
          </p>
          <p className="text-[10px] text-slate-400 text-center text-xs">
            {t(
              `מוצגות עד ${licenseMapDomMarkerCap} קונססיות בתצוגה. התקרבו לזום-אין לפרטים נוספים.`,
              `Showing up to ${licenseMapDomMarkerCap} concessions in view. Zoom in for more detail.`,
            )}
          </p>
        </div>
      )}
      {showWorldCountrySummaryNotice && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] max-w-md bg-slate-950/90 text-slate-100 border border-cyan-500/25 rounded-2xl px-4 py-2 shadow-2xl backdrop-blur-xl">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300 text-center">
            {t('סיכום מדינות גלובלי', 'Global country summary')}
          </p>
          <p className="text-[10px] text-slate-300 text-center leading-relaxed mt-1">
            {t(
              'תצוגה גלובלית לפי מדינה; התקרבו לזום 8+ לפרטי רישיון.',
              'Global country summary; zoom to level 8+ for license detail.',
            )}
          </p>
        </div>
      )}
      {borderCountriesCapped && borderGeoJsonMatchesMarkers && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-[1000] max-w-md bg-slate-950/85 text-slate-100 border border-cyan-500/20 rounded-xl px-3 py-1.5 shadow-lg backdrop-blur-xl">
          <p className="text-[9px] text-slate-400 text-center">
            {t(
              `קווי מתאר: עד ${borderCountryCap} מדינות עם הכי הרבה רישיונות בתצוגה.`,
              `Outlines: up to ${borderCountryCap} countries with the most licenses in view.`,
            )}
          </p>
        </div>
      )}
    </>
  );
}
