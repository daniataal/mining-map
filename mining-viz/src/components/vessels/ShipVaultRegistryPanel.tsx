import { Building2, RefreshCw } from 'lucide-react';
import type { ShipVaultProfile } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import OilLiveProvenanceBadge from '../../features/live-data/OilLiveProvenanceBadge';

function formatUSD(value?: number): string {
  if (!value || value <= 0) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export type ShipVaultRegistryPanelProps = {
  profile: ShipVaultProfile;
  mmsi: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  compact?: boolean;
};

/** ShipVault owner/registry block — shared by Live Data drawer and map maritime panel. */
export default function ShipVaultRegistryPanel({
  profile,
  mmsi,
  onRefresh,
  isRefreshing = false,
  compact = false,
}: ShipVaultRegistryPanelProps) {
  const { t } = useI18n();
  const v = profile.vessel;
  const owner = profile.owner_profile;
  const cachedAt = profile.cached_at ? new Date(profile.cached_at) : null;
  const daysSince = cachedAt
    ? Math.floor((Date.now() - cachedAt.getTime()) / 86_400_000)
    : null;

  return (
    <div className={`space-y-4 ${compact ? 'text-[10px]' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-violet-500" />
          <p className="text-[9px] font-black uppercase text-violet-500">
            {t('מאגר אוניות', 'Vessel Registry')}
          </p>
          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-bold uppercase">
            ShipVault
          </span>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 text-[9px] font-bold uppercase text-slate-500 hover:text-violet-500 disabled:opacity-40"
            title={t('עדכן נתוני אוניה', 'Refresh vessel data')}
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('עדכן', 'Refresh')}
          </button>
        )}
      </div>

      {v && (
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
            {v.flag && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('דגל', 'Flag')}</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-100">{v.flag}</dd>
              </>
            )}
            {v.vessel_class && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('סוג', 'Type')}</dt>
                <dd>{v.vessel_class}</dd>
              </>
            )}
            {v.build_year ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('שנת בניה', 'Built')}</dt>
                <dd>{v.build_year}</dd>
              </>
            ) : null}
            {v.builder && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('מספנה', 'Shipyard')}</dt>
                <dd>{v.builder}</dd>
              </>
            )}
            {v.deadweight_tons ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">DWT</dt>
                <dd>{v.deadweight_tons.toLocaleString()} t</dd>
              </>
            ) : null}
            {v.gross_tonnage ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">GT</dt>
                <dd>{v.gross_tonnage.toLocaleString()}</dd>
              </>
            ) : null}
            {v.estimated_value_usd ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('שווי', 'Est. Value')}</dt>
                <dd className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {formatUSD(v.estimated_value_usd)}
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      )}

      {(v?.owner_name || v?.operator_name || owner?.name) && (
        <section className="space-y-2">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('בעלים ומפעיל', 'Ownership & Operation')}
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 space-y-1.5">
            {(v?.owner_name || owner?.name) && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-16 shrink-0">
                  {t('בעלים', 'Owner')}
                </span>
                <span className="text-[10px] font-semibold text-slate-800 dark:text-slate-100">
                  {v?.owner_name || owner?.name}
                  {owner?.country && (
                    <span className="text-slate-400 font-normal ml-1">({owner.country})</span>
                  )}
                </span>
              </div>
            )}
            {owner?.shipvault_company_id && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-16 shrink-0">
                  {t('חברה', 'Company')}
                </span>
                <span className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                  ID {owner.shipvault_company_id}
                </span>
              </div>
            )}
            {v?.operator_name && v.operator_name !== v?.owner_name && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-16 shrink-0">
                  {t('מפעיל', 'Operator')}
                </span>
                <span className="text-[10px] text-slate-700 dark:text-slate-200">{v.operator_name}</span>
              </div>
            )}
            {owner?.fleet_size ? (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-16 shrink-0">
                  {t('צי', 'Fleet')}
                </span>
                <span className="text-[10px] text-slate-600 dark:text-slate-300">
                  {owner.fleet_size} {t('אוניות', 'vessels')}
                </span>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {(v?.name_history?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('היסטוריית שמות', 'Name History')}
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
            {v!.name_history!.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 text-[10px] border-b border-black/5 dark:border-white/5 last:border-b-0"
              >
                <span className="font-semibold text-slate-800 dark:text-slate-100">{entry.name}</span>
                <span className="text-slate-400">
                  {[entry.from_date, entry.to_date].filter(Boolean).join(' → ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(owner?.fleet?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('צי הבעלים', "Owner's Fleet")} ({owner!.fleet!.length})
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden">
            {owner!.fleet!.slice(0, 5).map((f, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 text-[10px] border-b border-black/5 dark:border-white/5 last:border-b-0"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">{f.name || '—'}</span>
                <span className="text-slate-400">{f.imo ? `IMO ${f.imo}` : ''}</span>
              </div>
            ))}
            {owner!.fleet!.length > 5 && (
              <div className="px-3 py-2 text-[9px] text-slate-400">
                +{owner!.fleet!.length - 5} {t('נוספות', 'more')}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="space-y-1">
        <OilLiveProvenanceBadge kind="registry" />
        {daysSince !== null && (
          <p className="text-[8px] text-slate-400">
            {t('נשמר לפני', 'Cached')} {daysSince === 0 ? t('היום', 'today') : `${daysSince}d ago`}
            {mmsi ? ` · MMSI ${mmsi}` : ''}
          </p>
        )}
        {profile.disclaimer && (
          <p className="text-[8px] text-amber-600 dark:text-amber-400">{profile.disclaimer}</p>
        )}
      </div>
    </div>
  );
}
