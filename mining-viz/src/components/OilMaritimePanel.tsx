import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MaritimeVessel } from '../lib/vessels/types';
import {
  getVesselShipVault,
  oilLiveApiUrl,
  refreshVesselEnrichment,
} from '../api/oilLiveApi';
import ShipVaultRegistryPanel from './vessels/ShipVaultRegistryPanel';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import MaritimeContextPanel from './MaritimeContextPanel';
import PanelErrorBoundary from './PanelErrorBoundary';
import { useI18n } from '../lib/i18n';
import { buildVesselFieldGroups } from './vessels/fieldDisplay';
import {
  Anchor as IconAnchor,
  ChevronDown,
  ChevronUp,
  Ship as IconShip,
  X as IconX,
} from 'lucide-react';

interface OilMaritimePanelProps {
  vessel: MaritimeVessel;
  onClose: () => void;
}

function FieldGrid({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="rounded-xl border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.03] px-3 py-2.5 min-w-0"
        >
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-0.5 truncate">{row.label}</p>
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

interface VesselTrackPoint {
  received_at?: string;
  latitude?: number;
  longitude?: number;
  speed_over_ground?: number | null;
  course_over_ground?: number | null;
}

interface VesselTrackResponse {
  points?: VesselTrackPoint[];
  unavailable?: boolean;
}

export default function OilMaritimePanel({ vessel, onClose }: OilMaritimePanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [rawOpen, setRawOpen] = useState(false);
  const groups = useMemo(() => buildVesselFieldGroups(vessel), [vessel]);
  const imo = String(vessel.imo ?? '').trim();
  const mmsiStr = String(vessel.mmsi ?? '').trim();

  const shipVaultQuery = useQuery({
    queryKey: ['vessel-shipvault', mmsiStr, imo],
    queryFn: () => getVesselShipVault(mmsiStr, imo ? { imo } : undefined),
    enabled: Boolean(mmsiStr && imo),
    staleTime: 86_400_000,
    retry: false,
  });

  const refreshShipVault = useMutation({
    mutationFn: () => refreshVesselEnrichment(mmsiStr),
    onSuccess: (data) => {
      queryClient.setQueryData(['vessel-shipvault', mmsiStr, imo], data);
    },
  });

  const shipVaultErrorText = useMemo(() => {
    if (!shipVaultQuery.error) return null;
    const msg = String((shipVaultQuery.error as Error)?.message || shipVaultQuery.error);
    if (/registry match|404/i.test(msg)) {
      return t(
        'אין התאמה במאגר ShipVault ל-IMO זה.',
        'No ShipVault registry match for this IMO.',
      );
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
  const trackQuery = useQuery<VesselTrackResponse>({
    queryKey: ['vessel-track', vessel.mmsi, 24],
    queryFn: async () => {
      const mmsi = String(vessel.mmsi ?? '').trim();
      if (!mmsi) return { points: [] };
      const response = await fetch(
        oilLiveApiUrl(`/api/oil-live/vessels/${encodeURIComponent(mmsi)}/track?hours=24`),
      );
      if (response.status === 404) {
        return { points: [], unavailable: true };
      }
      if (!response.ok) {
        throw new Error(`Track unavailable (${response.status})`);
      }
      return (await response.json()) as VesselTrackResponse;
    },
    enabled: Boolean(vessel.mmsi),
    staleTime: 60_000,
    retry: false,
  });
  const hasRawAis =
    Object.keys(vessel.ais_messages ?? {}).length > 0 || Object.keys(vessel.ais_metadata ?? {}).length > 0;

  return (
    <Card className="w-[min(92vw,720px)] max-h-[calc(100vh-100px)] overflow-hidden bg-stone-50/98 dark:bg-slate-950/95 border border-stone-200/90 dark:border-white/10 rounded-3xl shadow-2xl backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-3 p-5 border-b border-black/5 dark:border-white/5">
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

      <PanelErrorBoundary
        key={String(vessel.mmsi ?? vessel.id)}
        title="Vessel details unavailable"
      >
      <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
        {groups.map((group) => (
          <section key={group.title} className="space-y-2">
            <h4 className="text-[9px] font-black uppercase tracking-widest text-cyan-500">{group.title}</h4>
            <FieldGrid rows={group.rows} />
          </section>
        ))}

        {vessel.nearest_port && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-900/70">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                {t('נקודות', 'Points')}
              </p>
              <p className="text-[11px] font-bold text-slate-900 dark:text-white">
                {trackQuery.data?.points?.length ?? (trackQuery.isLoading ? '...' : 0)}
              </p>
            </div>
            {(trackQuery.data?.points ?? []).slice(-3).map((point, idx) => (
              <div key={`${point.received_at}-${idx}`} className="rounded-xl bg-white/60 px-3 py-2 dark:bg-slate-900/70">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">
                  {point.received_at ? new Date(point.received_at).toLocaleTimeString() : 'UTC'}
                </p>
                <p className="text-[10px] font-semibold text-slate-900 dark:text-white">
                  {point.latitude?.toFixed(3)}, {point.longitude?.toFixed(3)}
                </p>
              </div>
            ))}
          </div>
          {trackQuery.isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 animate-pulse">
              {[0, 1, 2].map((idx) => (
                <div key={idx} className="h-12 rounded-xl bg-white/40 dark:bg-slate-900/50" />
              ))}
            </div>
          )}
          {!trackQuery.isLoading && trackQuery.data?.unavailable && (
            <p className="text-[9px] text-amber-600 dark:text-amber-300">
              {t('מסלול לא זמין', 'Track unavailable')}
            </p>
          )}
          {!trackQuery.isLoading && trackQuery.isError && (
            <p className="text-[9px] text-amber-600 dark:text-amber-300">
              {t('לא ניתן לטעון מסלול כרגע.', 'Recent track is unavailable right now.')}
            </p>
          )}
          {!trackQuery.isLoading &&
            !trackQuery.isError &&
            !trackQuery.data?.unavailable &&
            (trackQuery.data?.points?.length ?? 0) === 0 && (
            <p className="text-[9px] text-slate-500">
              {t('אין נקודות מסלול ב-24 השעות האחרונות.', 'No track points in the last 24 hours.')}
            </p>
          )}
        </section>

        {hasRawAis && (
          <section className="rounded-2xl border border-black/5 dark:border-white/5 overflow-hidden">
            <button
              type="button"
              onClick={() => setRawOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
            >
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                {t('מטען AIS גולמי (כל סוגי ההודעות)', 'Raw AIS payloads (all message types)')}
              </span>
              {rawOpen ? <ChevronUp className="h-4 w-4 opacity-60" /> : <ChevronDown className="h-4 w-4 opacity-60" />}
            </button>
            {rawOpen && (
              <div className="max-h-64 overflow-auto border-t border-black/5 px-4 py-3 dark:border-white/5">
                <pre className="text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all font-mono">
                  {JSON.stringify({ metadata: vessel.ais_metadata, messages: vessel.ais_messages }, null, 2)}
                </pre>
              </div>
            )}
          </section>
        )}

        {imo && (
          <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            {shipVaultQuery.isLoading && (
              <p className="text-[9px] text-slate-500">{t('טוען מאגר…', 'Loading registry…')}</p>
            )}
            {shipVaultErrorText && (
              <p className="text-[9px] text-amber-600 dark:text-amber-300">
                {shipVaultErrorText}
              </p>
            )}
            {shipVaultQuery.data?.shipvault_profile && (
              <ShipVaultRegistryPanel
                profile={shipVaultQuery.data.shipvault_profile}
                mmsi={mmsiStr}
                compact
                onRefresh={() => refreshShipVault.mutate()}
                isRefreshing={refreshShipVault.isPending}
              />
            )}
          </section>
        )}

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
            section={shipVaultQuery.data?.shipvault_profile ? 'counterparties' : 'all'}
          />
        </PanelErrorBoundary>
      </div>
      </PanelErrorBoundary>
    </Card>
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
