import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MaritimeVessel } from '../lib/vessels/types';
import {
  getVesselShipVault,
  getVesselShipVaultDetail,
  refreshVesselEnrichment,
} from '../api/oilLiveApi';
import { useVesselTrack } from '../hooks/useVesselTrack';
import ShipVaultRegistryPanel from './vessels/ShipVaultRegistryPanel';
import ShipVaultCompanyPanel from './vessels/ShipVaultCompanyPanel';
import ShipVaultYardPanel from './vessels/ShipVaultYardPanel';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import MaritimeContextPanel from './MaritimeContextPanel';
import PanelErrorBoundary from './PanelErrorBoundary';
import { useI18n } from '../lib/i18n';
import { buildVesselFieldGroupsFiltered } from './vessels/fieldDisplay';
import type { FleetVesselPick } from '../lib/vessels/resolveFleetVessel';
import {
  Anchor as IconAnchor,
  ChevronDown,
  ChevronUp,
  Ship as IconShip,
  X as IconX,
} from 'lucide-react';

type MaritimeTab = 'identity' | 'position' | 'registry' | 'context';

interface OilMaritimePanelProps {
  vessel: MaritimeVessel;
  onClose: () => void;
  onSelectVessel?: (pick: FleetVesselPick) => Promise<MaritimeVessel | null> | MaritimeVessel | null;
}

function FieldGrid({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="rounded-xl border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.03] px-3 py-2.5 min-w-0"
        >
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-0.5 truncate">
            {row.label}
          </p>
          <p className="text-[11px] font-semibold text-slate-900 dark:text-white break-words">{row.value}</p>
        </div>
      ))}
    </div>
  );
}

function VesselBadges({ vessel }: { vessel: MaritimeVessel }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge className="bg-slate-950/10 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-none text-[8px] font-black uppercase">
        MMSI {vessel.mmsi}
      </Badge>
      {vessel.imo && (
        <Badge className="bg-slate-950/10 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-none text-[8px] font-black uppercase">
          IMO {vessel.imo}
        </Badge>
      )}
      <Badge className="bg-cyan-500/10 text-cyan-400 border-none text-[8px] font-black uppercase">
        {vessel.ship_type_label || 'Vessel'}
      </Badge>
      {vessel.speed_knots != null && (
        <Badge className="bg-slate-950/10 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-none text-[8px] font-black uppercase">
          {vessel.speed_knots} kn
        </Badge>
      )}
    </div>
  );
}

type ShipVaultOverlay =
  | { kind: 'company'; id?: string; name: string }
  | { kind: 'yard'; id?: string; name: string }
  | null;

const TAB_ORDER: MaritimeTab[] = ['identity', 'position', 'registry', 'context'];

export default function OilMaritimePanel({ vessel, onClose, onSelectVessel }: OilMaritimePanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [rawOpen, setRawOpen] = useState(false);
  const [tab, setTab] = useState<MaritimeTab>('identity');
  const [overlay, setOverlay] = useState<ShipVaultOverlay>(null);
  const [fleetPickLoading, setFleetPickLoading] = useState(false);
  const [fleetPickError, setFleetPickError] = useState<string | null>(null);
  const groups = useMemo(() => buildVesselFieldGroupsFiltered(vessel), [vessel]);
  const imo = String(vessel.imo ?? '').trim();
  const mmsiStr = String(vessel.mmsi ?? '').trim();

  const identityGroups = useMemo(
    () => groups.filter((g) => g.title === 'Identity' || g.title === 'Voyage'),
    [groups],
  );
  const positionGroups = useMemo(
    () =>
      groups.filter((g) =>
        ['Position', 'Motion', 'Dimensions', 'Feed'].includes(g.title),
      ),
    [groups],
  );

  const shipVaultQuery = useQuery({
    queryKey: ['vessel-shipvault', mmsiStr, imo],
    queryFn: () => getVesselShipVault(mmsiStr, imo ? { imo } : undefined),
    enabled: Boolean(mmsiStr && imo),
    staleTime: 86_400_000,
    retry: false,
  });

  const shipVaultDetailQuery = useQuery({
    queryKey: ['vessel-shipvault-detail', mmsiStr, imo, shipVaultQuery.data?.shipvault_profile?.vessel?.shipvault_vessel_id],
    queryFn: () =>
      getVesselShipVaultDetail(mmsiStr, {
        imo,
        vessel_id: shipVaultQuery.data?.shipvault_profile?.vessel?.shipvault_vessel_id,
      }),
    enabled: Boolean(mmsiStr && imo && tab === 'registry' && !!shipVaultQuery.data?.shipvault_profile),
    staleTime: 86_400_000,
    retry: false,
  });

  const refreshShipVault = useMutation({
    mutationFn: () => refreshVesselEnrichment(mmsiStr),
    onSuccess: (data) => {
      queryClient.setQueryData(['vessel-shipvault', mmsiStr, imo], data);
      void queryClient.invalidateQueries({ queryKey: ['vessel-shipvault-detail', mmsiStr] });
    },
  });

  const shipVaultErrorText = useMemo(() => {
    if (!shipVaultQuery.error) return null;
    const msg = String((shipVaultQuery.error as Error)?.message || shipVaultQuery.error);
    if (/registry match|404/i.test(msg)) {
      return t('אין התאמה במאגר ShipVault ל-IMO זה.', 'No ShipVault registry match for this IMO.');
    }
    if (/not configured|503/i.test(msg)) {
      return t(
        'ShipVault לא מוגדר בשרת — נדרש bootstrap של refresh token.',
        'ShipVault is not configured on the server — bootstrap a Firebase refresh token.',
      );
    }
    if (/auth|401|token|expired/i.test(msg)) {
      return t(
        'אימות ShipVault נכשל — עדכן bearer token או bootstrap refresh token מ-DevTools.',
        'ShipVault authentication failed — update bearer token or bootstrap refresh token from DevTools.',
      );
    }
    return msg || t('שגיאת ShipVault', 'ShipVault error');
  }, [shipVaultQuery.error, t]);

  const trackQuery = useVesselTrack(vessel.mmsi, 24, Boolean(vessel.mmsi) && tab === 'position');

  const hasRawAis =
    Object.keys(vessel.ais_messages ?? {}).length > 0 || Object.keys(vessel.ais_metadata ?? {}).length > 0;

  const tabLabel = (id: MaritimeTab) => {
    switch (id) {
      case 'identity':
        return t('זהות', 'Identity');
      case 'position':
        return t('מיקום', 'Position');
      case 'registry':
        return t('מאגר', 'Registry');
      case 'context':
        return t('הקשר', 'Context');
    }
  };

  const handleFleetPick = async (pick: FleetVesselPick) => {
    if (!onSelectVessel) return;
    setFleetPickError(null);
    setFleetPickLoading(true);
    try {
      const resolved = await onSelectVessel(pick);
      if (!resolved) {
        setFleetPickError(
          t(
            'לא נמצא כלי שיט — בדוק IMO/MMSI או נסה שוב.',
            'Could not resolve vessel — check IMO/MMSI or try again.',
          ),
        );
        return;
      }
      setOverlay(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFleetPickError(msg || t('בחירת כלי שיט נכשלה.', 'Vessel selection failed.'));
    } finally {
      setFleetPickLoading(false);
    }
  };

  return (
    <Card className="oil-maritime-panel relative w-[min(92vw,720px)] max-h-[calc(100vh-100px)] overflow-hidden bg-stone-50/98 dark:bg-slate-950/95 border border-stone-200/90 dark:border-white/10 rounded-3xl shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-black/5 dark:border-white/5 shrink-0">
        <div className="min-w-0 flex-1">
          <PanelHeader vessel={vessel} t={t} />
          <VesselBadges vessel={vessel} />
        </div>
        <Button
          onClick={onClose}
          variant="ghost"
          className="h-9 w-9 p-0 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
        >
          <IconX className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-black/5 dark:border-white/5 shrink-0 overflow-x-auto">
        {TAB_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-colors ${
              tab === id
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tabLabel(id)}
          </button>
        ))}
      </div>

      <PanelErrorBoundary key={String(vessel.mmsi ?? vessel.id)} title="Vessel details unavailable">
        <div className="relative p-4 overflow-y-auto max-h-[calc(100vh-220px)] min-h-[12rem]">
          {tab === 'identity' &&
            identityGroups.map((group) => (
              <section key={group.title} className="space-y-2 mb-4">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-cyan-500">{group.title}</h4>
                <FieldGrid rows={group.rows} />
              </section>
            ))}

          {tab === 'position' && (
            <>
              {positionGroups.map((group) => (
                <section key={group.title} className="space-y-2 mb-4">
                  <h4 className="text-[9px] font-black uppercase tracking-widest text-cyan-500">{group.title}</h4>
                  <FieldGrid rows={group.rows} />
                </section>
              ))}
              {vessel.nearest_port && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 mb-4">
                  <PortHeader t={t} />
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{vessel.nearest_port.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {[vessel.nearest_port.unlocode, vessel.nearest_port.country_iso2].filter(Boolean).join(' · ')}
                  </p>
                </div>
              )}
              <section className="space-y-2 rounded-2xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/5 dark:bg-white/[0.03]">
                <h4 className="text-[9px] font-black uppercase tracking-widest text-cyan-500">
                  {t('מסלול אחרון', 'Recent track')}
                </h4>
                <TrackSummary trackQuery={trackQuery} t={t} />
              </section>
              {hasRawAis && (
                <section className="rounded-2xl border border-black/5 dark:border-white/5 overflow-hidden mt-4">
                  <button
                    type="button"
                    onClick={() => setRawOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                      {t('מטען AIS גולמי', 'Raw AIS payloads')}
                    </span>
                    {rawOpen ? <ChevronUp className="h-4 w-4 opacity-60" /> : <ChevronDown className="h-4 w-4 opacity-60" />}
                  </button>
                  {rawOpen && (
                    <div className="max-h-48 overflow-auto border-t border-black/5 px-4 py-3 dark:border-white/5">
                      <pre className="text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all font-mono">
                        {JSON.stringify({ metadata: vessel.ais_metadata, messages: vessel.ais_messages }, null, 2)}
                      </pre>
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {tab === 'registry' && (
            <section className="relative rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3 min-h-[8rem]">
              {!imo && (
                <p className="text-[10px] text-amber-600 dark:text-amber-300">
                  {t('נדרש IMO לעשרת ShipVault.', 'IMO required for ShipVault registry enrichment.')}
                </p>
              )}
              {imo && shipVaultQuery.isLoading && (
                <p className="text-[9px] text-slate-500">{t('טוען מאגר…', 'Loading registry…')}</p>
              )}
              {shipVaultErrorText && (
                <p className="text-[9px] text-amber-600 dark:text-amber-300">{shipVaultErrorText}</p>
              )}
              {shipVaultQuery.data?.shipvault_profile && (
                <ShipVaultRegistryPanel
                  profile={shipVaultQuery.data.shipvault_profile}
                  mmsi={mmsiStr}
                  aisTypeLabel={vessel.ship_type_label ?? undefined}
                  detail={shipVaultDetailQuery.data?.detail}
                  compact
                  onRefresh={() => refreshShipVault.mutate()}
                  isRefreshing={refreshShipVault.isPending}
                  onOpenCompany={(id, name) => {
                    setFleetPickError(null);
                    setOverlay({ kind: 'company', id, name: name || '' });
                  }}
                  onOpenYard={(id, name) => {
                    setFleetPickError(null);
                    setOverlay({ kind: 'yard', id, name });
                  }}
                  onSelectFleetVessel={onSelectVessel ? handleFleetPick : undefined}
                />
              )}
            </section>
          )}

          {tab === 'context' && (
            <PanelErrorBoundary
              key={`maritime-context-${vessel.mmsi ?? vessel.id}`}
              title="Maritime intelligence unavailable"
            >
              <MaritimeContextPanel
                key={`maritime-context-panel-${vessel.mmsi ?? vessel.id}`}
                query={{
                  vessel_name: vessel.vessel_name,
                  mmsi: vessel.mmsi,
                  imo: vessel.imo || '',
                  destination: vessel.destination || '',
                  lat: vessel.lat,
                  lng: vessel.lng,
                }}
                section="all"
              />
            </PanelErrorBoundary>
          )}

          {overlay?.kind === 'company' && (
            <ShipVaultCompanyPanel
              companyId={overlay.id}
              ownerName={overlay.name}
              onClose={() => setOverlay(null)}
              onSelectFleetVessel={onSelectVessel ? handleFleetPick : undefined}
              fleetPickLoading={fleetPickLoading}
              fleetPickError={fleetPickError}
            />
          )}
          {overlay?.kind === 'yard' && (
            <ShipVaultYardPanel
              yardId={overlay.id}
              yardName={overlay.name}
              onClose={() => setOverlay(null)}
              onSelectVessel={onSelectVessel ? handleFleetPick : undefined}
              fleetPickLoading={fleetPickLoading}
              fleetPickError={fleetPickError}
            />
          )}
        </div>
      </PanelErrorBoundary>
    </Card>
  );
}

function TrackSummary({
  trackQuery,
  t,
}: {
  trackQuery: {
    isLoading: boolean;
    isError: boolean;
    data?: { points?: { received_at?: string; latitude?: number; longitude?: number }[]; unavailable?: boolean };
  };
  t: (he: string, en: string) => string;
}) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-900/70">
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">{t('נקודות', 'Points')}</p>
          <p className="text-[11px] font-bold">
            {trackQuery.data?.points?.length ?? (trackQuery.isLoading ? '...' : 0)}
          </p>
        </div>
        {(trackQuery.data?.points ?? []).slice(-3).map((point, idx) => (
          <div key={`${point.received_at}-${idx}`} className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-900/70">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
              {point.received_at ? new Date(point.received_at).toLocaleTimeString() : 'UTC'}
            </p>
            <p className="text-[10px] font-semibold">
              {point.latitude?.toFixed(3)}, {point.longitude?.toFixed(3)}
            </p>
          </div>
        ))}
      </div>
      {!trackQuery.isLoading && trackQuery.data?.unavailable && (
        <p className="text-[9px] text-amber-600 dark:text-amber-300 mt-2">{t('מסלול לא זמין', 'Track unavailable')}</p>
      )}
      {!trackQuery.isLoading && trackQuery.isError && (
        <p className="text-[9px] text-amber-600 dark:text-amber-300 mt-2">
          {t('לא ניתן לטעון מסלול כרגע.', 'Recent track is unavailable right now.')}
        </p>
      )}
    </>
  );
}

function PanelHeader({ vessel, t }: { vessel: MaritimeVessel; t: (he: string, en: string) => string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-9 h-9 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
        <IconShip className="w-4 h-4 text-cyan-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
          {t('מעקב ימי', 'Maritime Watch')}
        </p>
        <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
          {vessel.vessel_name}
        </h3>
      </div>
    </div>
  );
}

function PortHeader({ t }: { t: (he: string, en: string) => string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <IconAnchor className="w-4 h-4 text-emerald-400" />
      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
        {t('עוגן נמל קרוב', 'Nearest port context')}
      </p>
    </div>
  );
}
