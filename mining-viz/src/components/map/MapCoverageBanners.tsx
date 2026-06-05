type TranslateFn = (he: string, en: string) => string;

type LiveDataVesselStatusBanner = {
  headlineHe: string;
  headlineEn: string;
  detailHe?: string;
  detailEn?: string;
};

type MapCoverageBannersProps = {
  t: TranslateFn;
  showLiveDataVesselWatch: boolean;
  liveDataVesselStatus: LiveDataVesselStatusBanner | null;
  showLimitedAisCoverageBanner: boolean;
};

export default function MapCoverageBanners({
  t,
  showLiveDataVesselWatch,
  liveDataVesselStatus,
  showLimitedAisCoverageBanner,
}: MapCoverageBannersProps) {
  return (
    <>
      {showLiveDataVesselWatch && liveDataVesselStatus && (
        <div
          className="pointer-events-none absolute left-3 right-3 top-3 z-[640] sm:left-6 sm:max-w-xl"
          role="status"
        >
          <div className="rounded-2xl border border-sky-500/35 bg-sky-500/12 px-4 py-3 text-[10px] font-semibold leading-snug text-sky-950 shadow-lg dark:text-sky-50">
            <p className="font-black uppercase tracking-widest text-[9px] text-sky-700 dark:text-sky-200">
              {t('מעקב מכליות (נתונים חיים)', 'Live Data vessel watch')}
            </p>
            <p className="mt-1">{t(liveDataVesselStatus.headlineHe, liveDataVesselStatus.headlineEn)}</p>
            {liveDataVesselStatus.detailEn && liveDataVesselStatus.detailHe && (
              <p className="mt-1 opacity-90">
                {t(liveDataVesselStatus.detailHe, liveDataVesselStatus.detailEn)}
              </p>
            )}
          </div>
        </div>
      )}
      {showLimitedAisCoverageBanner && (
        <div
          className="pointer-events-auto absolute left-3 right-3 top-3 z-[650] rounded-2xl border border-amber-500/40 bg-amber-500/15 px-4 py-3 text-[10px] font-semibold leading-snug text-amber-950 shadow-lg dark:text-amber-50 sm:left-6 sm:max-w-xl"
          role="status"
        >
          <p className="font-black uppercase tracking-widest text-[9px] text-amber-700 dark:text-amber-200">
            {t('כיסוי AIS מוגבל — מפרץ / הורמוז', 'Limited AIS coverage — Gulf / Hormuz')}
          </p>
          <p className="mt-1">
            {t(
              'מקור AISStream דליל במפרץ הפרסי ובמפרץ עומאן — היעדר מכליות על המפה אינו הוכחה ליעדר תנועה. הריצו oil-live-intel-worker, הרחיבו maritime_watch_zones, ובדקו /api/oil-live/coverage.',
              'AISStream is sparse in the Persian Gulf and Gulf of Oman — an empty map is not proof of no traffic. Run oil-live-intel-worker, expand maritime_watch_zones, and check /api/oil-live/coverage.',
            )}
          </p>
        </div>
      )}
    </>
  );
}
