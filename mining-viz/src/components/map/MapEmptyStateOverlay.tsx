type TranslateFn = (he: string, en: string) => string;

type MapEmptyStateOverlayProps = {
  t: TranslateFn;
  show: boolean;
};

export default function MapEmptyStateOverlay({ t, show }: MapEmptyStateOverlayProps) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-sm">
      <div className="text-4xl mb-2">🔍</div>
      <h3 className="text-lg font-bold">{t('לא נמצאו נכסים', 'No assets found')}</h3>
      <p className="text-sm text-slate-400">
        {t(
          'נסה לשנות מסננים, להתקרב לזום, או לבדוק כיסוי AIS — ייתכן שאין נתונים באזור זה.',
          'Try adjusting filters, zooming in, or check AIS coverage — data may be sparse in this region.',
        )}
      </p>
    </div>
  );
}
