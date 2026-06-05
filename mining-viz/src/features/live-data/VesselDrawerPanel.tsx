import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, ArrowLeftRight, ExternalLink, Loader2, Ship } from 'lucide-react';
import ShipVaultRegistryPanel from '../../components/vessels/ShipVaultRegistryPanel';
import {
  getVesselDossier,
  refreshVesselEnrichment,
  type MeridianCargoRecord,
  type OilPortCall,
  type VesselDossierParty,
} from '../../api/oilLiveApi';
import {
  getVesselStsHistory,
  isStsEventVerified,
  stsInferenceDisclaimer,
  stsVesselLabel,
  verifyStsEvent,
  type StsEvent,
} from '../../api/stsEventsApi';
import { useI18n } from '../../lib/i18n';
import OilLiveProvenanceBadge from './OilLiveProvenanceBadge';
import StsConfidenceBadge from './StsConfidenceBadge';
import StsEnrichmentBlock from './StsEnrichmentBlock';
import { isStsAnalystMode } from './stsAnalystMode';

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

function stsDurationLabel(start?: string, end?: string): string {
  if (!start || !end) return '—';
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '—';
  const mins = Math.round((b - a) / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function StsEventRow({
  event,
  subjectMmsi,
  onVerified,
}: {
  event: StsEvent;
  subjectMmsi: string;
  onVerified?: (updated: StsEvent) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const analystMode = isStsAnalystMode();
  const verified = isStsEventVerified(event);
  const [showVerifyForm, setShowVerifyForm] = useState(false);
  const [notes, setNotes] = useState('');

  const verifyMutation = useMutation({
    mutationFn: () => verifyStsEvent(event.id, notes.trim()),
    onSuccess: (res) => {
      const updated =
        res.event ??
        (res.id ? (res as StsEvent) : { ...event, status: 'verified', verification_notes: notes.trim() });
      onVerified?.(updated);
      queryClient.invalidateQueries({ queryKey: ['oil-live-vessel-sts-history', subjectMmsi] });
      queryClient.invalidateQueries({ queryKey: ['oil-live-sts-events'] });
      setShowVerifyForm(false);
      setNotes('');
    },
  });

  const subject = Number(subjectMmsi);
  const otherSide = event.mmsi_a === subject ? 'b' : 'a';
  const otherMmsi = otherSide === 'a' ? event.mmsi_a : event.mmsi_b;
  const badgeTier = verified ? 'verified' : event.confidence_tier;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 text-[10px] space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StsConfidenceBadge tier={badgeTier} />
        {event.status && !verified && (
          <span className="text-[9px] uppercase text-slate-400">{event.status}</span>
        )}
      </div>
      <p className="font-semibold text-slate-800 dark:text-slate-100">
        {t('עם', 'With')}: {stsVesselLabel(event, otherSide)}
      </p>
      <p className="text-slate-500">
        MMSI {otherMmsi} · {formatTs(event.start_ts)} → {formatTs(event.end_ts)}
        {' · '}
        {stsDurationLabel(event.start_ts, event.end_ts)}
      </p>
      {event.min_distance_m != null && (
        <p className="text-slate-500">
          {t('מרחק מינימלי', 'Min distance')}: {Math.round(event.min_distance_m)} m
        </p>
      )}
      {event.zone_name && (
        <p className="text-slate-500">
          {t('אזור', 'Zone')}: {event.zone_name}
        </p>
      )}
      <StsEnrichmentBlock event={event} compact />
      {analystMode && !verified && (
        <div className="pt-1 space-y-1.5">
          {!showVerifyForm ? (
            <button
              type="button"
              className="text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-300 hover:underline"
              onClick={() => setShowVerifyForm(true)}
            >
              {t('סמן כמאומת', 'Mark verified')}
            </button>
          ) : (
            <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
              <label className="block text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300">
                {t('הערות אימות', 'Verification notes')}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 px-2 py-1 text-[10px]"
                placeholder={t(
                  'מה נבדק? (קרבה, נמל, מטען…)',
                  'What was reviewed? (proximity, port, cargo…)',
                )}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={verifyMutation.isPending || !notes.trim()}
                  className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[9px] font-bold uppercase disabled:opacity-40"
                  onClick={() => verifyMutation.mutate()}
                >
                  {verifyMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                  ) : (
                    t('אשר', 'Confirm')
                  )}
                </button>
                <button
                  type="button"
                  className="text-[9px] font-bold uppercase text-slate-500"
                  onClick={() => {
                    setShowVerifyForm(false);
                    setNotes('');
                  }}
                >
                  {t('ביטול', 'Cancel')}
                </button>
              </div>
              {verifyMutation.isError && (
                <p className="text-[9px] text-red-500">
                  {verifyMutation.error instanceof Error
                    ? verifyMutation.error.message
                    : t('האימות נכשל', 'Verification failed')}
                </p>
              )}
            </div>
          )}
        </div>
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

  const {
    data: stsHistory,
    isLoading: stsLoading,
    isError: stsError,
    error: stsErr,
  } = useQuery({
    queryKey: ['oil-live-vessel-sts-history', mmsi],
    queryFn: () => getVesselStsHistory(mmsi, { limit: 30 }),
    staleTime: 60_000,
  });

  const [localStsEvents, setLocalStsEvents] = useState<StsEvent[] | null>(null);
  const stsEvents = localStsEvents ?? stsHistory?.events ?? [];

  useEffect(() => {
    setLocalStsEvents(null);
  }, [mmsi]);

  const handleStsVerified = (updated: StsEvent) => {
    setLocalStsEvents((prev) => {
      const base = prev ?? stsHistory?.events ?? [];
      return base.map((ev) => (ev.id === updated.id ? { ...ev, ...updated } : ev));
    });
  };

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
            <div className="space-y-1">
              <p className="text-slate-500 text-[10px]">
                {t('אין מיקום AIS שמור ל-MMSI זה', 'No stored AIS position for this MMSI')}
              </p>
              <p className="text-[9px] text-amber-800 dark:text-amber-200 leading-relaxed">
                {t(
                  'חוסר AIS במפרץ הפרסי / מפרץ עומאן הוא לעיתים מגבלת ספק — לא הוכחה שאין תנועה.',
                  'Missing AIS in the Persian Gulf / Gulf of Oman is often provider coverage — not proof of no traffic.',
                )}
              </p>
            </div>
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
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-violet-500" />
              <p className="text-[9px] font-black uppercase text-violet-500">
                {t('קרבת STS מסקנית', 'Inferred STS proximity')} (
                {stsHistory?.count ?? stsHistory?.events?.length ?? 0})
              </p>
            </div>
            <p className="text-[9px] text-amber-800 dark:text-amber-200 leading-relaxed">
              {stsInferenceDisclaimer(stsHistory?.disclaimer)}
            </p>
            {stsLoading && (
              <p className="text-[10px] text-slate-500 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('טוען היסטוריית STS…', 'Loading STS history…')}
              </p>
            )}
            {stsError && (
              <p className="text-[10px] text-red-500">
                {stsErr instanceof Error ? stsErr.message : 'Failed to load STS history'}
              </p>
            )}
            {!stsLoading && !stsError && stsEvents.length === 0 && (
              <p className="text-[10px] text-slate-500">
                {t(
                  'אין אירועי קרבה STS שמורים ל-MMSI זה',
                  'No stored STS proximity events for this MMSI',
                )}
              </p>
            )}
            {stsEvents.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {stsEvents.map((ev) => (
                  <StsEventRow
                    key={ev.id}
                    event={ev}
                    subjectMmsi={mmsi}
                    onVerified={handleStsVerified}
                  />
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
        <ShipVaultRegistryPanel
          profile={data.shipvault_profile}
          mmsi={String(mmsi)}
          onRefresh={() => refreshMutation.mutate()}
          isRefreshing={refreshMutation.isPending}
        />
      )}
    </div>
  );
}
