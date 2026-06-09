import { memo, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CircleMarker, LayerGroup, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Loader2 } from 'lucide-react';
import {
  getStsEventById,
  getStsEvents,
  isStsEventVerified,
  stsEventCoords,
  stsInferenceDisclaimer,
  stsVesselLabel,
  type StsEvent,
} from '../../api/stsEventsApi';
import type { OilLiveEntityClickPayload } from '../../components/petroleum/oilLiveEntityPayload';
import type { MaritimeViewportBounds } from '../../types';
import { useI18n } from '../../lib/i18n';
import StsConfidenceBadge from './StsConfidenceBadge';
import StsEnrichmentBlock from './StsEnrichmentBlock';

const STS_CLUSTER_MAX_ZOOM = 8;

const TIER_MARKER_COLOR: Record<string, string> = {
  low: '#64748b',
  medium: '#d97706',
  high: '#059669',
  very_high: '#0891b2',
  verified: '#047857',
};

function markerColor(tier?: string, status?: string): string {
  if ((status ?? '').toLowerCase() === 'verified' || (tier ?? '').toLowerCase() === 'verified') {
    return TIER_MARKER_COLOR.verified;
  }
  const key = (tier ?? 'low').toLowerCase().replace(/\s+/g, '_');
  return TIER_MARKER_COLOR[key] ?? '#7c3aed';
}

function formatTs(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function formatDuration(start?: string, end?: string): string {
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

function VesselLink({
  event,
  side,
  onOpenVessel,
}: {
  event: StsEvent;
  side: 'a' | 'b';
  onOpenVessel?: (payload: OilLiveEntityClickPayload) => void;
}) {
  const mmsi = side === 'a' ? event.mmsi_a : event.mmsi_b;
  const label = stsVesselLabel(event, side);
  if (!onOpenVessel) return <span>{label}</span>;
  return (
    <button
      type="button"
      className="font-semibold text-sky-700 dark:text-sky-300 underline underline-offset-2 hover:text-sky-900 dark:hover:text-sky-100"
      onClick={() =>
        onOpenVessel({
          entityKind: 'vessel',
          entityId: String(mmsi),
          title: label,
        })
      }
    >
      {label}
    </button>
  );
}

function StsEventPopupBody({
  event,
  disclaimerText,
  onOpenVessel,
}: {
  event: StsEvent;
  disclaimerText: string;
  onOpenVessel?: (payload: OilLiveEntityClickPayload) => void;
}) {
  const { t } = useI18n();
  const verified = isStsEventVerified(event);
  const badgeTier = verified ? 'verified' : event.confidence_tier;

  return (
    <div className="oil-live-popup-body">
      <StsConfidenceBadge tier={badgeTier} className="mb-1" />
      <strong>{t('קרבת STS מסקנית', 'Inferred STS proximity')}</strong>
      <p>
        <VesselLink event={event} side="a" onOpenVessel={onOpenVessel} />
        {' ↔ '}
        <VesselLink event={event} side="b" onOpenVessel={onOpenVessel} />
      </p>
      <p className="oil-live-popup-muted">
        {onOpenVessel ? (
          <>
            <button
              type="button"
              className="text-sky-700 dark:text-sky-300 underline underline-offset-2"
              onClick={() =>
                onOpenVessel({
                  entityKind: 'vessel',
                  entityId: String(event.mmsi_a),
                  title: stsVesselLabel(event, 'a'),
                })
              }
            >
              MMSI {event.mmsi_a}
            </button>
            {' · '}
            <button
              type="button"
              className="text-sky-700 dark:text-sky-300 underline underline-offset-2"
              onClick={() =>
                onOpenVessel({
                  entityKind: 'vessel',
                  entityId: String(event.mmsi_b),
                  title: stsVesselLabel(event, 'b'),
                })
              }
            >
              MMSI {event.mmsi_b}
            </button>
          </>
        ) : (
          <>
            MMSI {event.mmsi_a} · MMSI {event.mmsi_b}
          </>
        )}
      </p>
      <p>
        {formatTs(event.start_ts)} → {formatTs(event.end_ts)}
        {' · '}
        {formatDuration(event.start_ts, event.end_ts)}
      </p>
      {event.min_distance_m != null && (
        <p className="oil-live-popup-muted">
          {t('מרחק מינימלי', 'Min distance')}: {Math.round(event.min_distance_m)} m
        </p>
      )}
      {event.zone_name && (
        <p className="oil-live-popup-muted">
          {t('אזור', 'Zone')}: {event.zone_name}
        </p>
      )}
      {event.status && !verified && (
        <p className="oil-live-popup-muted">
          {t('סטטוס', 'Status')}: {event.status}
        </p>
      )}
      <StsEnrichmentBlock event={event} compact />
      <p className="text-[10px] text-amber-800 dark:text-amber-200 leading-snug mt-1">
        {disclaimerText}
      </p>
    </div>
  );
}

function StsEventPopup({
  event,
  fallbackDisclaimer,
  onOpenVessel,
}: {
  event: StsEvent;
  fallbackDisclaimer: string;
  onOpenVessel?: (payload: OilLiveEntityClickPayload) => void;
}) {
  const { t } = useI18n();
  const [popupOpen, setPopupOpen] = useState(false);

  const { data: enriched, isLoading, isError } = useQuery({
    queryKey: ['oil-live-sts-event', event.id],
    queryFn: () => getStsEventById(event.id),
    enabled: popupOpen,
    staleTime: 120_000,
  });

  const displayEvent = enriched ?? event;
  const disclaimerText = stsInferenceDisclaimer(enriched?.disclaimer) || fallbackDisclaimer;

  return (
    <Popup
      eventHandlers={{
        add: () => setPopupOpen(true),
        remove: () => setPopupOpen(false),
      }}
    >
      {popupOpen && isLoading ? (
        <div className="oil-live-popup-body flex items-center gap-2 py-2 text-xs text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          {t('טוען העשרה…', 'Loading enrichment…')}
        </div>
      ) : (
        <>
          {isError && (
            <p className="text-[9px] text-amber-700 dark:text-amber-300 mb-1">
              {t('העשרה לא זמינה — מוצגות נתוני בסיס', 'Enrichment unavailable — showing base event')}
            </p>
          )}
          <StsEventPopupBody
            event={displayEvent}
            disclaimerText={disclaimerText}
            onOpenVessel={onOpenVessel}
          />
        </>
      )}
    </Popup>
  );
}

function StsEventMarker({
  event,
  disclaimerText,
  onOpenVessel,
}: {
  event: StsEvent;
  disclaimerText: string;
  onOpenVessel?: (payload: OilLiveEntityClickPayload) => void;
}) {
  const coords = stsEventCoords(event)!;
  const color = markerColor(event.confidence_tier, event.status);

  return (
    <CircleMarker
      center={[coords.lat, coords.lon]}
      radius={8}
      pathOptions={{
        color,
        fillColor: color,
        fillOpacity: 0.75,
        weight: 2,
      }}
    >
      <StsEventPopup
        event={event}
        fallbackDisclaimer={disclaimerText}
        onOpenVessel={onOpenVessel}
      />
    </CircleMarker>
  );
}

type Props = {
  enabled: boolean;
  viewport?: MaritimeViewportBounds | null;
  mapZoom?: number;
  limit?: number;
  onOpenVessel?: (payload: OilLiveEntityClickPayload) => void;
};

function StsEventsMapLayer({
  enabled,
  viewport,
  mapZoom = 5,
  limit = 150,
  onOpenVessel,
}: Props) {
  const bbox = viewport
    ? `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`
    : undefined;
  const viewportReady = Boolean(bbox);
  const clusterMarkers = mapZoom < STS_CLUSTER_MAX_ZOOM;

  const { data } = useQuery({
    queryKey: ['oil-live-sts-events', bbox, limit],
    queryFn: () => getStsEvents({ bbox: bbox!, limit }),
    enabled: enabled && viewportReady,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled && viewportReady ? 120_000 : false,
  });

  const events = useMemo(() => {
    return (data?.events ?? []).filter((e) => stsEventCoords(e) != null);
  }, [data?.events]);

  const disclaimerText = stsInferenceDisclaimer(data?.disclaimer);

  if (!enabled) return null;

  const markers = events.map((event) => (
    <StsEventMarker
      key={event.id}
      event={event}
      disclaimerText={disclaimerText}
      onOpenVessel={onOpenVessel}
    />
  ));

  return (
    <LayerGroup>
      {clusterMarkers ? (
        <MarkerClusterGroup
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          maxClusterRadius={52}
          disableClusteringAtZoom={STS_CLUSTER_MAX_ZOOM}
        >
          {markers}
        </MarkerClusterGroup>
      ) : (
        markers
      )}
    </LayerGroup>
  );
}

export default memo(StsEventsMapLayer);
