import { Building2, ChevronRight, RefreshCw } from 'lucide-react';
import type { ShipVaultProfile, ShipVaultVesselDetail } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import type { FleetVesselPick } from '../../lib/vessels/resolveFleetVessel';
import { formatTonnage, typesMismatch } from '../../lib/vessels/shipvaultNormalize';
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
  aisTypeLabel?: string;
  detail?: ShipVaultVesselDetail | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  compact?: boolean;
  /** companyId may be empty when only owner name is known — panel resolves via ShipVault search. */
  onOpenCompany?: (companyId: string | undefined, name: string) => void;
  onOpenYard?: (yardId: string | undefined, name: string) => void;
  onSelectFleetVessel?: (pick: FleetVesselPick) => void;
};

/** ShipVault owner/registry block — shared by Live Data drawer and map maritime panel. */
export default function ShipVaultRegistryPanel({
  profile,
  mmsi,
  aisTypeLabel,
  detail,
  onRefresh,
  isRefreshing = false,
  compact = false,
  onOpenCompany,
  onOpenYard,
  onSelectFleetVessel,
}: ShipVaultRegistryPanelProps) {
  const { t } = useI18n();
  const v = detail ?? profile.vessel;
  const owner = profile.owner_profile;
  const cachedAt = profile.cached_at ? new Date(profile.cached_at) : null;
  const daysSince = cachedAt
    ? Math.floor((Date.now() - cachedAt.getTime()) / 86_400_000)
    : null;
  const registryType = v?.vessel_class;
  const showTypeMismatch = typesMismatch(aisTypeLabel, registryType);
  const companyId = owner?.shipvault_company_id || v?.owner_company_id;
  const ownerName = (v?.owner_name || owner?.name || '').trim();
  const yardName = detail?.yard_name || v?.builder;
  const yardId = detail?.yard_id;

  return (
    <div className={`space-y-3 ${compact ? 'text-[10px]' : ''}`}>
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
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('עדכן', 'Refresh')}
          </button>
        )}
      </div>

      {showTypeMismatch && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-800 dark:text-amber-200">
          <p className="font-bold uppercase tracking-wide mb-1">{t('סוג — אי-התאמה', 'Type mismatch')}</p>
          <p>
            {t('AIS', 'AIS')}: <span className="font-semibold">{aisTypeLabel}</span>
            {' · '}
            {t('מאגר', 'Registry')}: <span className="font-semibold">{registryType}</span>
          </p>
          <p className="text-[8px] mt-1 opacity-80">
            {t(
              'שני המקורות מוצגים — AIS משקף דיווח שידור; ShipVault משקף סיווג רישום.',
              'Both sources shown — AIS reflects broadcast reporting; ShipVault reflects registry classification.',
            )}
          </p>
        </div>
      )}

      {v && (
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
            {v.flag && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('דגל', 'Flag')}</dt>
                <dd className="font-semibold">{v.flag}</dd>
              </>
            )}
            {registryType && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('סוג (מאגר)', 'Type (registry)')}</dt>
                <dd>{registryType}</dd>
              </>
            )}
            {v.build_year ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('שנת בניה', 'Built')}</dt>
                <dd>{v.build_year}</dd>
              </>
            ) : null}
            {yardName && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('מספנה', 'Shipyard')}</dt>
                <dd>
                  {onOpenYard ? (
                    <button
                      type="button"
                      className="text-left font-semibold text-cyan-500 hover:underline inline-flex items-center gap-0.5"
                      onClick={() => onOpenYard(yardId, yardName)}
                    >
                      {yardName}
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  ) : (
                    yardName
                  )}
                </dd>
              </>
            )}
            {v.deadweight_tons ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">DWT</dt>
                <dd>{formatTonnage(v.deadweight_tons)} t</dd>
              </>
            ) : null}
            {v.gross_tonnage ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">GT</dt>
                <dd>{formatTonnage(v.gross_tonnage)}</dd>
              </>
            ) : null}
            {detail?.net_tonnage ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">NT</dt>
                <dd>{formatTonnage(detail.net_tonnage)}</dd>
              </>
            ) : null}
            {detail?.length_m ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('אורך', 'Length')}</dt>
                <dd>{detail.length_m} m</dd>
              </>
            ) : null}
            {detail?.beam_m ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('רוחב', 'Beam')}</dt>
                <dd>{detail.beam_m} m</dd>
              </>
            ) : null}
            {detail?.propulsion && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('הנעה', 'Propulsion')}</dt>
                <dd>{detail.propulsion}</dd>
              </>
            )}
            {v.estimated_value_usd ? (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('שווי', 'Est. Value')}</dt>
                <dd className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {formatUSD(v.estimated_value_usd)}
                </dd>
              </>
            ) : null}
            {detail?.status && (
              <>
                <dt className="text-slate-400 uppercase font-bold">{t('סטטוס', 'Status')}</dt>
                <dd>{detail.status}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {(v?.owner_name || v?.operator_name || owner?.name) && (
        <section className="space-y-1.5">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('בעלים ומפעיל', 'Ownership & Operation')}
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 space-y-1.5">
            {ownerName && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-14 shrink-0">
                  {t('בעלים', 'Owner')}
                </span>
                {onOpenCompany ? (
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-cyan-500 hover:underline text-left inline-flex items-center gap-0.5 cursor-pointer"
                    aria-label={t(`צי של ${ownerName}`, `Fleet for ${ownerName}`)}
                    onClick={() => onOpenCompany(companyId || undefined, ownerName)}
                  >
                    {ownerName}
                    {owner?.country && (
                      <span className="text-slate-400 font-normal ml-1">({owner.country})</span>
                    )}
                    <ChevronRight className="w-3 h-3 shrink-0" aria-hidden />
                  </button>
                ) : (
                  <span className="text-[10px] font-semibold">
                    {ownerName}
                    {owner?.country && (
                      <span className="text-slate-400 font-normal ml-1">({owner.country})</span>
                    )}
                  </span>
                )}
              </div>
            )}
            {v?.operator_name && v.operator_name !== v?.owner_name && (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-14 shrink-0">
                  {t('מפעיל', 'Operator')}
                </span>
                <span className="text-[10px]">{v.operator_name}</span>
              </div>
            )}
            {owner?.fleet_size ? (
              <div className="flex items-start gap-2">
                <span className="text-[9px] text-slate-400 uppercase font-bold w-14 shrink-0">
                  {t('צי', 'Fleet')}
                </span>
                <span className="text-[10px] text-slate-600 dark:text-slate-300">
                  {owner.fleet_size} {t('אוניות', 'vessels')}
                  {ownerName && onOpenCompany && (
                    <button
                      type="button"
                      className="ml-2 text-cyan-500 hover:underline font-bold uppercase text-[8px] cursor-pointer"
                      onClick={() => onOpenCompany(companyId || undefined, ownerName)}
                    >
                      {t('צפה בצי', 'View fleet')}
                    </button>
                  )}
                </span>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {(v?.name_history?.length ?? 0) > 0 && (
        <section className="space-y-1.5">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('היסטוריית שמות', 'Name History')}
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden max-h-32 overflow-y-auto">
            {v!.name_history!.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-1.5 text-[10px] border-b border-black/5 dark:border-white/5 last:border-b-0"
              >
                <span className="font-semibold">{entry.name}</span>
                <span className="text-slate-400 text-[9px]">
                  {[entry.from_date, entry.to_date].filter(Boolean).join(' → ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(owner?.fleet?.length ?? 0) > 0 && (
        <section className="space-y-1.5">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('צי (תצוגה מקדימה)', 'Fleet preview')} ({owner!.fleet!.length})
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 overflow-hidden max-h-36 overflow-y-auto">
            {owner!.fleet!.slice(0, 8).map((f, i) => (
              <button
                key={i}
                type="button"
                disabled={!onSelectFleetVessel}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-[10px] border-b border-black/5 dark:border-white/5 last:border-b-0 text-left ${
                  onSelectFleetVessel ? 'hover:bg-violet-500/10 cursor-pointer' : ''
                }`}
                onClick={() => onSelectFleetVessel?.({
                  imo: f.imo,
                  mmsi: f.mmsi,
                  name: f.name,
                  shipvault_vessel_id: f.shipvault_vessel_id,
                })}
              >
                <span className="font-medium">{f.name || '—'}</span>
                <span className="text-slate-400 text-[9px]">
                  {[f.type, f.imo ? `IMO ${f.imo}` : ''].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(detail?.events?.length ?? 0) > 0 && (
        <section className="space-y-1.5">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('אירועים', 'Events')}
          </p>
          <div className="rounded-xl border border-black/5 dark:border-white/10 max-h-28 overflow-y-auto px-3 py-2 text-[9px] font-mono text-slate-500">
            {detail!.events!.slice(0, 5).map((ev, i) => (
              <pre key={i} className="whitespace-pre-wrap break-all mb-1">
                {JSON.stringify(ev)}
              </pre>
            ))}
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
