import { useQuery } from '@tanstack/react-query';
import { getShipVaultYard, type ShipVaultFleetItem } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import { formatTonnage } from '../../lib/vessels/shipvaultNormalize';
import type { FleetVesselPick } from '../../lib/vessels/resolveFleetVessel';
import ShipVaultSlideOver from './ShipVaultSlideOver';

export type ShipVaultYardPanelProps = {
  yardId?: string;
  yardName: string;
  onClose: () => void;
  onSelectVessel?: (pick: FleetVesselPick) => void | Promise<void>;
  fleetPickLoading?: boolean;
  fleetPickError?: string | null;
};

export default function ShipVaultYardPanel({
  yardId,
  yardName,
  onClose,
  onSelectVessel,
  fleetPickLoading,
  fleetPickError,
}: ShipVaultYardPanelProps) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['shipvault-yard', yardId ?? '_', yardName],
    queryFn: () => getShipVaultYard(yardId || '_', { name: yardName }),
    staleTime: 86_400_000,
    retry: false,
  });
  const y = query.data?.yard;
  const vessels: ShipVaultFleetItem[] = y?.vessels_built ?? [];

  return (
    <ShipVaultSlideOver
      title={y?.name || yardName}
      subtitle={[y?.location, y?.country].filter(Boolean).join(' · ') || undefined}
      onClose={onClose}
    >
      {query.isLoading && (
        <p className="text-[10px] text-slate-500">{t('טוען מספנה…', 'Loading yard…')}</p>
      )}
      {query.error && (
        <p className="text-[10px] text-amber-600 dark:text-amber-300">
          {t(
            'פרטי מספנה לא זמינים ב-ShipVault — מוצג שם בלבד.',
            'Yard detail unavailable from ShipVault — showing name only.',
          )}{' '}
          <span className="opacity-80">{String((query.error as Error).message || '')}</span>
        </p>
      )}
      {vessels.length > 0 ? (
        <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
          {vessels.map((row, i) => (
            <button
              key={`${row.imo ?? row.shipvault_vessel_id}-${i}`}
              type="button"
              disabled={fleetPickLoading}
              className="flex w-full items-center justify-between px-3 py-2 text-[10px] border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-violet-500/10 text-left disabled:opacity-60"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectVessel?.({
                  imo: row.imo,
                  mmsi: row.mmsi,
                  name: row.name,
                  shipvault_vessel_id: row.shipvault_vessel_id,
                });
              }}
            >
              <span className="font-semibold text-slate-900 dark:text-white">{row.name || '—'}</span>
              <span className="text-slate-400 shrink-0 ml-2">
                {[row.type, row.built ? String(row.built) : '', formatTonnage(row.dwt)]
                  .filter((x) => x && x !== '—')
                  .join(' · ')}
              </span>
            </button>
          ))}
        </div>
      ) : (
        !query.isLoading && (
          <p className="text-[10px] text-slate-500">
            {t('אין רשימת אוניות שנבנו במספנה.', 'No vessels-built list returned for this yard.')}
          </p>
        )
      )}
      {fleetPickLoading && (
        <p className="text-[9px] text-violet-500 animate-pulse mt-2">
          {t('מאתר כלי שיט…', 'Resolving vessel…')}
        </p>
      )}
      {fleetPickError && (
        <p className="text-[9px] text-amber-600 dark:text-amber-300 mt-2">{fleetPickError}</p>
      )}
    </ShipVaultSlideOver>
  );
}
