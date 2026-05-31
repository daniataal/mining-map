import { useQuery } from '@tanstack/react-query';
import { getShipVaultCompany, type ShipVaultFleetItem } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import { formatAgeYears, formatTonnage } from '../../lib/vessels/shipvaultNormalize';
import type { FleetVesselPick } from '../../lib/vessels/resolveFleetVessel';
import ShipVaultSlideOver from './ShipVaultSlideOver';

export type ShipVaultCompanyPanelProps = {
  /** ShipVault company id when known; omit to resolve from ownerName. */
  companyId?: string;
  ownerName?: string;
  onClose: () => void;
  onSelectFleetVessel?: (pick: FleetVesselPick) => void | Promise<void>;
  fleetPickLoading?: boolean;
  fleetPickError?: string | null;
};

function FleetTable({
  fleet,
  onSelect,
  disabled,
}: {
  fleet: ShipVaultFleetItem[];
  onSelect?: (pick: FleetVesselPick) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  if (fleet.length === 0) {
    return (
      <p className="text-[10px] text-slate-500">
        {t('אין נתוני צי זמינים.', 'No fleet rows available.')}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-left text-slate-500 uppercase tracking-wider border-b border-black/5 dark:border-white/10">
            <th className="px-2 py-2 font-bold">{t('שם', 'Name')}</th>
            <th className="px-2 py-2 font-bold">{t('סוג', 'Type')}</th>
            <th className="px-2 py-2 font-bold">DWT</th>
            <th className="px-2 py-2 font-bold">GT</th>
            <th className="px-2 py-2 font-bold">{t('בניה', 'Built')}</th>
            <th className="px-2 py-2 font-bold">{t('מספנה', 'Yard')}</th>
          </tr>
        </thead>
        <tbody>
          {fleet.map((row, i) => (
            <tr
              key={`${row.imo ?? row.shipvault_vessel_id ?? row.name}-${i}`}
              className={`border-b border-black/5 dark:border-white/5 last:border-b-0 ${
                onSelect && !disabled ? 'cursor-pointer hover:bg-violet-500/10' : ''
              } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect?.({
                  imo: row.imo,
                  mmsi: row.mmsi,
                  name: row.name,
                  shipvault_vessel_id: row.shipvault_vessel_id,
                });
              }}
            >
              <td className="px-2 py-2 font-semibold text-slate-900 dark:text-white">{row.name || '—'}</td>
              <td className="px-2 py-2 text-slate-600 dark:text-slate-300">{row.type || '—'}</td>
              <td className="px-2 py-2">{formatTonnage(row.dwt)}</td>
              <td className="px-2 py-2">{formatTonnage(row.gt)}</td>
              <td className="px-2 py-2">{row.built || '—'}</td>
              <td className="px-2 py-2 text-slate-500 truncate max-w-[8rem]">{row.yard || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ShipVaultCompanyPanel({
  companyId,
  ownerName,
  onClose,
  onSelectFleetVessel,
  fleetPickLoading,
  fleetPickError,
}: ShipVaultCompanyPanelProps) {
  const { t } = useI18n();
  const resolveName = (ownerName || '').trim();
  const id = (companyId || '').trim();
  const query = useQuery({
    queryKey: ['shipvault-company', id || '_', resolveName],
    queryFn: () =>
      getShipVaultCompany(id || '_', resolveName ? { name: resolveName } : undefined),
    enabled: Boolean(id || resolveName),
    staleTime: 86_400_000,
    retry: false,
  });
  const c = query.data?.company;
  const title = c?.name || resolveName || t('חברה', 'Company');

  return (
    <ShipVaultSlideOver title={title} subtitle={c?.country} onClose={onClose}>
      {query.isLoading && (
        <p className="text-[10px] text-slate-500">
          {resolveName && !id
            ? t('מאתר חברה וטוען צי…', 'Resolving company and loading fleet…')
            : t('טוען צי…', 'Loading fleet…')}
        </p>
      )}
      {query.error && (
        <p className="text-[10px] text-amber-600 dark:text-amber-300">
          {t(
            'פרטי צי לא זמינים ב-ShipVault — מוצג שם בעלים בלבד.',
            'Fleet detail unavailable from ShipVault — showing owner name only.',
          )}{' '}
          {resolveName && (
            <span className="font-semibold text-slate-700 dark:text-slate-200">{resolveName}</span>
          )}
          <span className="block mt-1 opacity-80 text-[9px]">
            {String((query.error as Error).message || query.error)}
          </span>
        </p>
      )}
      {c && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-[10px]">
            {c.city && (
              <>
                <dt className="text-slate-500 uppercase font-bold">{t('מיקום', 'Location')}</dt>
                <dd>{[c.city, c.country].filter(Boolean).join(', ')}</dd>
              </>
            )}
            {c.parent_name && (
              <>
                <dt className="text-slate-500 uppercase font-bold">{t('חברת אם', 'Parent')}</dt>
                <dd>{c.parent_name}</dd>
              </>
            )}
            <dt className="text-slate-500 uppercase font-bold">{t('אוניות', 'Vessels')}</dt>
            <dd>{c.fleet_size ?? c.fleet?.length ?? '—'}</dd>
            <dt className="text-slate-500 uppercase font-bold">{t('סה״כ DWT', 'Total DWT')}</dt>
            <dd>{formatTonnage(c.total_dwt)}</dd>
            <dt className="text-slate-500 uppercase font-bold">{t('סה״כ GT', 'Total GT')}</dt>
            <dd>{formatTonnage(c.total_gt)}</dd>
            <dt className="text-slate-500 uppercase font-bold">{t('גיל ממוצע', 'Avg age')}</dt>
            <dd>
              {formatAgeYears(c.avg_age_years)}
              {c.avg_age_years ? ` ${t('שנים', 'yrs')}` : ''}
            </dd>
          </dl>
          <section className="space-y-2">
            <p className="text-[9px] font-black uppercase text-slate-500">
              {t('צי', 'Fleet')} ({c.fleet?.length ?? 0})
            </p>
            <FleetTable
              fleet={c.fleet ?? []}
              onSelect={onSelectFleetVessel}
              disabled={fleetPickLoading}
            />
            {fleetPickLoading && (
              <p className="text-[9px] text-violet-500 animate-pulse">
                {t('מאתר כלי שיט…', 'Resolving vessel…')}
              </p>
            )}
            {fleetPickError && (
              <p className="text-[9px] text-amber-600 dark:text-amber-300">{fleetPickError}</p>
            )}
            {onSelectFleetVessel && !fleetPickLoading && (
              <p className="text-[8px] text-slate-400">
                {t('לחץ על שורה לבחירת כלי שיט במפה.', 'Click a row to select that vessel on the map.')}
              </p>
            )}
          </section>
        </div>
      )}
    </ShipVaultSlideOver>
  );
}
