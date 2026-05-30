import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Building2, ExternalLink, Loader2, RefreshCw, Ship } from 'lucide-react';
import {
  getVesselDossier,
  refreshVesselEnrichment,
  type MeridianCargoRecord,
  type OilPortCall,
  type ShipVaultProfile,
  type VesselDossierParty,
} from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';

type VesselDrawerTab = 'overview' | 'mcr' | 'registry';

type Props = {
  mmsi: string;
  title?: string;
  onOpenCargo?: (cargoId: string, label?: string) => void;
  onOpenCompanyDossier?: (companyId: string) => void;
};

function formatTs(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function tierKind(tier?: string, provenance?: string): string {
  return tier ?? provenance ?? 'inferred';
}

function PartyRow({
  party,
  onOpenCompanyDossier,
}: {
  party: VesselDossierParty;
  onOpenCompanyDossier?: (companyId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <OilLiveProvenanceBadge kind={tierKind(party.bol_tier, party.data_provenance)} />
        <span className="text-[9px] font-black uppercase text-slate-400">{party.role}</span>
        {party.confidence != null && (
          <span className="text-[9px] text-slate-500">
            {Math.round(party.confidence * 100)}%
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-slate-900 dark:text-white">{party.name}</p>
      <div className="flex flex-wrap gap-2 text-[9px] text-slate-500">
        {party.lei && <span>LEI {party.lei}</span>}
        {party.sanctions_status && (
          <span>
            {t('סנקציות', 'Sanctions')}: {party.sanctions_status}
          </span>
        )}
        {party.synthetic_bol_id && <span className="font-mono">{party.synthetic_bol_id}</span>}
      </div>
      {party.company_id && onOpenCompanyDossier && (
        <button
          type="button"
          className="text-[9px] font-bold uppercase text-sky-600 inline-flex items-center gap-0.5"
          onClick={() => onOpenCompanyDossier(party.company_id!)}
        >
          <ExternalLink className="w-3 h-3" />
          {t('דוסייה', 'Dossier')}
        </button>
      )}
    </div>
  );
}

function PortCallRow({ pc }: { pc: OilPortCall }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 p-3 text-[10px] space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <OilLiveProvenanceBadge kind={tierKind(pc.bol_tier, pc.data_provenance)} />
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {pc.terminal_name ?? pc.terminal_id ?? '—'}
        </span>
        {pc.status && (
          <span className="text-[9px] uppercase text-slate-400">{pc.status}</span>
        )}
      </div>
      <p className="text-slate-600 dark:text-slate-300">
        {[pc.country, pc.product_family_inferred].filter(Boolean).join(' · ')}
      </p>
      <p className="text-slate-500">
        {formatTs(pc.arrival_ts)} → {formatTs(pc.departure_ts)}
        {pc.confidence != null && ` · ${Math.round(pc.confidence * 100)}%`}
      </p>
      {(pc.source_links?.length ?? 0) > 0 && (
        <ul className="space-y-0.5">
          {pc.source_links!.map((link, i) => (
            <li key={i}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 dark:text-sky-400 underline inline-flex items-center gap-0.5"
              >
                {link.name ?? link.url}
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {pc.disclaimer && (
        <p className="text-[9px] text-amber-700 dark:text-amber-300">{pc.disclaimer}</p>
      )}
    </div>
  );
}

function McrRow({
  row,
  onOpenCargo,
}: {
  row: MeridianCargoRecord;
  onOpenCargo?: (cargoId: string, label?: string) => void;
}) {
  const { t } = useI18n();
  const label =
    row.synthetic_bol_id ??
    `${row.commodity_family ?? 'Cargo'} ${row.load_port_name ?? ''}`.trim();
  return (
    <button
      type="button"
      className="w-full text-left rounded-xl border border-black/5 dark:border-white/10 p-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
      onClick={() => onOpenCargo?.(row.id, label)}
      disabled={!onOpenCargo}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <OilLiveProvenanceBadge kind={tierKind(row.bol_tier, row.data_provenance)} />
        <span className="text-[10px] font-semibold text-slate-800 dark:text-slate-100">
          {row.commodity_family ?? row.commodity_description ?? 'MCR'}
        </span>
        {row.confidence != null && (
          <span className="text-[9px] text-slate-500">{Math.round(row.confidence * 100)}%</span>
        )}
      </div>
      <p className="text-[10px] text-slate-600 dark:text-slate-300">
        {row.shipper_name ?? '—'} → {row.consignee_name ?? row.discharge_hint ?? '—'}
      </p>
      <p className="text-[9px] text-slate-500 mt-0.5">
        {[row.load_port_name, row.discharge_hint].filter(Boolean).join(' → ')}
        {row.bol_tier && ` · ${row.bol_tier}`}
      </p>
      {onOpenCargo && (
        <span className="text-[9px] font-bold uppercase text-sky-600 mt-1 inline-block">
          {t('פתח MCR', 'Open MCR')}
        </span>
      )}
    </button>
  );
}

// ─── Registry (ShipVault) Panel ───────────────────────────────────────────────

function formatUSD(value?: number): string {
  if (!value || value <= 0) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function RegistryPanel({
  profile,
  mmsi,
  onRefresh,
  isRefreshing,
}: {
  profile: ShipVaultProfile;
  mmsi: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const { t } = useI18n();
  const v = profile.vessel;
  const owner = profile.owner_profile;
  const cachedAt = profile.cached_at ? new Date(profile.cached_at) : null;
  const daysSince = cachedAt
    ? Math.floor((Date.now() - cachedAt.getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-4">
      {/* Header row */}
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
      </div>

      {/* Vessel identity grid */}
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

      {/* Owner / Operator */}
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

      {/* Name history */}
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

      {/* Fleet preview (first 5) */}
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

      {/* Provenance footer */}
      <div className="space-y-1">
        <OilLiveProvenanceBadge kind="registry" />
        {daysSince !== null && (
          <p className="text-[8px] text-slate-400">
            {t('נשמר לפני', 'Cached')} {daysSince === 0 ? t('היום', 'today') : `${daysSince}d ago`}
          </p>
        )}
        {profile.disclaimer && (
          <p className="text-[8px] text-amber-600 dark:text-amber-400">{profile.disclaimer}</p>
        )}
      </div>
    </div>
  );
}

export default function VesselDrawerPanel({ mmsi, title, onOpenCargo, onOpenCompanyDossier }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<VesselDrawerTab>('overview');
  const [mcrOffset, setMcrOffset] = useState(0);
  const mcrLimit = 20;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['oil-live-vessel-dossier', mmsi, mcrOffset],
    queryFn: () => getVesselDossier(mmsi, { mcr_limit: mcrLimit, mcr_offset: mcrOffset }),
    staleTime: 30_000,
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshVesselEnrichment(mmsi),
    onSuccess: (refreshed) => {
      queryClient.setQueryData(
        ['oil-live-vessel-dossier', mmsi, mcrOffset],
        (old: typeof data) =>
          old ? { ...old, shipvault_profile: refreshed.shipvault_profile } : old,
      );
    },
  });

  const mcrTotal = data?.cargo_records.total ?? 0;
  const hasMcr = mcrTotal > 0;
  const hasRegistry = !!data?.shipvault_profile;

  return (
    <div className="space-y-4 text-[11px]">
      <div className="flex gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => setTab('overview')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
            tab === 'overview'
              ? 'bg-cyan-500 text-slate-950'
              : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          {t('סקירה', 'Overview')}
        </button>
        <button
          type="button"
          onClick={() => setTab('mcr')}
          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
            tab === 'mcr'
              ? 'bg-amber-500 text-slate-950'
              : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          {t('מטען MCR', 'MCR')} {hasMcr ? `(${mcrTotal})` : ''}
        </button>
        {hasRegistry && (
          <button
            type="button"
            onClick={() => setTab('registry')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${
              tab === 'registry'
                ? 'bg-violet-500 text-white'
                : 'text-slate-500 hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {t('מאגר', 'Registry')}
          </button>
        )}
      </div>

      {isLoading && (
        <p className="text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('טוען תיק כלי…', 'Loading vessel dossier…')}
        </p>
      )}
      {isError && (
        <p className="text-red-500">{error instanceof Error ? error.message : 'Failed to load'}</p>
      )}

      {data && tab === 'overview' && (
        <>
          {data.position ? (
            <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-cyan-500" />
                <p className="text-[9px] font-black uppercase text-cyan-500">
                  {t('מיקום AIS אחרון', 'Last AIS position')}
                </p>
                <OilLiveProvenanceBadge
                  kind={tierKind(data.position.bol_tier, data.position.data_provenance)}
                />
              </div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {title ?? data.position.vessel_name ?? `MMSI ${mmsi}`}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('קואורדינטות', 'Position')}</dt>
                  <dd>
                    {data.position.lat?.toFixed(4)}, {data.position.lng?.toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('זמן', 'Time')}</dt>
                  <dd>{formatTs(data.position.position_time)}</dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('מקור', 'Source')}</dt>
                  <dd>{data.position.source ?? data.position.data_source ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-400 uppercase font-bold">{t('רעננות', 'Freshness')}</dt>
                  <dd>
                    {data.position.freshness_seconds != null
                      ? `${Math.round(data.position.freshness_seconds / 60)} min`
                      : '—'}
                  </dd>
                </div>
              </dl>
              {data.position.source_url && (
                <a
                  href={data.position.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[9px] text-sky-600 underline inline-flex items-center gap-0.5"
                >
                  {t('מקור', 'Source')}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </section>
          ) : (
            <p className="text-slate-500 text-[10px]">
              {t('אין מיקום AIS שמור ל-MMSI זה', 'No stored AIS position for this MMSI')}
            </p>
          )}

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Anchor className="w-4 h-4 text-emerald-500" />
              <p className="text-[9px] font-black uppercase text-emerald-500">
                {t('קריאות נמל', 'Port calls')} ({data.port_calls.length})
              </p>
            </div>
            {data.port_calls.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                {t('אין קריאות נמל שמורות', 'No stored port calls')}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.port_calls.map((pc) => (
                  <PortCallRow key={pc.id} pc={pc} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-[9px] font-black uppercase text-slate-500">
              {t('צדדים מועמדים (MCR)', 'Candidate parties (MCR)')}
            </p>
            {data.parties.length === 0 ? (
              <p className="text-[10px] text-slate-500">
                {t('אין צדדים מקושרים', 'No linked parties')}
              </p>
            ) : (
              <div className="space-y-2">
                {data.parties.map((party, i) => (
                  <PartyRow
                    key={`${party.role}-${party.name}-${i}`}
                    party={party}
                    onOpenCompanyDossier={onOpenCompanyDossier}
                  />
                ))}
              </div>
            )}
          </section>

          {data.disclaimer && (
            <p className="text-[9px] text-amber-700 dark:text-amber-300">{data.disclaimer}</p>
          )}
        </>
      )}

      {data && tab === 'mcr' && (
        <section className="space-y-2">
          {data.cargo_records.items.length === 0 ? (
            <p className="text-[10px] text-slate-500">
              {t('אין רשומות MCR מקושרות', 'No linked MCR records')}
            </p>
          ) : (
            <>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {data.cargo_records.items.map((row) => (
                  <McrRow key={row.id} row={row} onOpenCargo={onOpenCargo} />
                ))}
              </div>
              {mcrTotal > mcrLimit && (
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    disabled={mcrOffset <= 0}
                    className="text-[9px] font-bold uppercase text-sky-600 disabled:opacity-40"
                    onClick={() => setMcrOffset((o) => Math.max(0, o - mcrLimit))}
                  >
                    {t('הקודם', 'Previous')}
                  </button>
                  <span className="text-[9px] text-slate-500 self-center">
                    {mcrOffset + 1}–{Math.min(mcrOffset + mcrLimit, mcrTotal)} / {mcrTotal}
                  </span>
                  <button
                    type="button"
                    disabled={mcrOffset + mcrLimit >= mcrTotal}
                    className="text-[9px] font-bold uppercase text-sky-600 disabled:opacity-40"
                    onClick={() => setMcrOffset((o) => o + mcrLimit)}
                  >
                    {t('הבא', 'Next')}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      {data && tab === 'registry' && data.shipvault_profile && (
        <RegistryPanel
          profile={data.shipvault_profile}
          mmsi={String(mmsi)}
          onRefresh={() => refreshMutation.mutate()}
          isRefreshing={refreshMutation.isPending}
        />
      )}
    </div>
  );
}
