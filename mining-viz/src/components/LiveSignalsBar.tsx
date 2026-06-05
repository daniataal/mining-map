import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../lib/i18n';

type MaritimeStats = {
  stored_vessel_count?: number;
  last_cycle_upserted?: number;
};

type Props = {
  workspaceEntityCount?: number;
  onVesselClick?: () => void;
  onLicenseClick?: () => void;
  onSupplierClick?: () => void;
  onAlertClick?: () => void;
};

async function fetchMaritimeStats(): Promise<MaritimeStats> {
  const res = await fetch('/api/oil-live/maritime/stats');
  if (!res.ok) return {};
  return res.json() as Promise<MaritimeStats>;
}

export function LiveSignalsBar({
  workspaceEntityCount = 0,
  onVesselClick,
  onLicenseClick,
  onSupplierClick,
  onAlertClick,
}: Props) {
  const { t } = useI18n();
  const { data: stats } = useQuery({
    queryKey: ['live-signals-maritime'],
    queryFn: fetchMaritimeStats,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const vesselMoves = stats?.last_cycle_upserted ?? stats?.stored_vessel_count ?? 0;
  const licenseUpdates = 0;
  const supplierChanges = workspaceEntityCount;
  const routeAlerts = 0;

  const segments = [
    {
      label: t('תנועות כלי שיט', 'vessel movements'),
      count: vesselMoves,
      onClick: onVesselClick,
      honest: vesselMoves === 0,
    },
    {
      label: t('עדכוני רישיון', 'license updates'),
      count: licenseUpdates,
      onClick: onLicenseClick,
      honest: true,
    },
    {
      label: t('שינויי ספקים', 'supplier changes'),
      count: supplierChanges,
      onClick: onSupplierClick,
      honest: supplierChanges === 0,
    },
    {
      label: t('התראות מסלול', 'route alerts'),
      count: routeAlerts,
      onClick: onAlertClick,
      honest: true,
    },
  ];

  const hasAny = segments.some((s) => s.count > 0);

  return (
    <div className="shrink-0 border-t border-stone-200/90 dark:border-white/10 bg-stone-50/95 dark:bg-slate-950/90 backdrop-blur-xl px-3 py-2 z-50">
      <div className="flex items-center gap-2 overflow-x-auto text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
        <span className="shrink-0 text-amber-600 dark:text-amber-400">
          {t('אותות חיים', 'Live Signals')}
        </span>
        <span className="text-slate-400 shrink-0">—</span>
        {!hasAny ? (
          <span className="text-slate-500 normal-case font-semibold tracking-normal">
            {t(
              'אין אותות חדשים — כיסוי AIS עשוי להיות דליל',
              'No new signals — AIS coverage may be sparse',
            )}
          </span>
        ) : (
          segments.map((seg, i) => (
            <span key={seg.label} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-slate-400">·</span>}
              <button
                type="button"
                onClick={seg.onClick}
                className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
              >
                {seg.count} {seg.label}
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
