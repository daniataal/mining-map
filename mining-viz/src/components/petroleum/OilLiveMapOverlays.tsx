import { memo, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Marker, Popup, Polyline, Rectangle, LayerGroup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet-polylinedecorator';
import { createOilTerminalClusterIconFactory } from '../../lib/mapClusterIcons';
import OilLiveProvenanceBadge from '../../features/live-data/OilLiveProvenanceBadge';
import {
  connectOilLiveWebSocket,
  getCargoRecordsMap,
  getOilLiveCoverage,
  getOilLiveMap,
  getOilOpportunities,
  getTradeFlows,
  type MeridianCargoRecord,
  type OilLiveVessel,
  type OilLiveCoverageCell,
  type OilLiveWatchZone,
  type OilOpportunity,
  type OilTerminal,
  type TradeFlowArc,
} from '../../api/oilLiveApi';
import type { MaritimeViewportBounds } from '../../types';
import type {
  OilLiveDrawerTab,
  OilLiveEntityKind,
} from '../../features/live-data/OilLiveEntityDrawer';
import { dedupeOpportunities } from '../../features/live-data/dedupeOpportunities';
import { LIVE_DATA_DEFAULT_LAYERS } from '../../features/live-data/liveDataMapDefaults';
import {
  commodityMatchesFilter,
  terminalMatchesSearch,
} from '../../features/live-data/liveDataWorkflow';
import {
  bezierMidpoint,
  commodityColor,
  recencyOpacity,
  tierDashArray,
  tierDoubleStroke,
  volumeToWeight,
  type LatLngTuple,
} from '../../lib/corridorGeometry';

export type OilLiveEntityClickPayload = {
  entityKind: OilLiveEntityKind;
  entityId: string;
  opportunityId?: string;
  title?: string;
  subtitle?: string;
  /** Opens entity drawer on Trading workflow tab (MAD-46 §8). */
  initialDrawerTab?: OilLiveDrawerTab;
};

export type OilLiveLayerVisibility = {
  terminals: boolean;
  vessels: boolean;
  corridors: boolean;
  opportunities: boolean;
  /** Aggregated company-pair / country-pair "Trade Flow" arcs. Off by default. */
  tradeFlows: boolean;
  /** Open AIS coverage quality / gap overlay. */
  coverage: boolean;
};

/** Cap of per-MCR arrows kept on the map at once (Phase 1 constraint). */
const MAX_PER_MCR_ARROWS = 200;
/** Cap of aggregated Trade Flow arcs (Phase 2 constraint). */
const MAX_TRADE_FLOW_ARROWS = 80;

const terminalIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 0 8px rgba(37,99,235,.7)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const vesselIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:10px;height:10px;border-radius:2px;background:#f59e0b;border:1px solid #fff;transform:rotate(45deg)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

const oppIcon = new L.DivIcon({
  className: '',
  html: '<div style="min-width:18px;height:18px;border-radius:9px;background:#10b981;color:#fff;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;border:2px solid #fff">!</div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const COVERAGE_STYLE: Record<string, L.PathOptions> = {
  strong: { color: '#059669', fillColor: '#10b981', fillOpacity: 0.08, weight: 1 },
  fair: { color: '#0ea5e9', fillColor: '#38bdf8', fillOpacity: 0.08, weight: 1 },
  sparse: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1, weight: 1 },
  gap: { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.06, weight: 1 },
  coverage_gap: { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.04, weight: 2, dashArray: '6 4' },
};

function coveragePathOptions(quality?: string): L.PathOptions {
  return COVERAGE_STYLE[quality ?? 'gap'] ?? COVERAGE_STYLE.gap;
}

function inViewport(
  lat: number,
  lng: number,
  vp: MaritimeViewportBounds | null | undefined,
): boolean {
  if (!vp) return true;
  return lat >= vp.south && lat <= vp.north && lng >= vp.west && lng <= vp.east;
}

function hasLoadCoords(r: MeridianCargoRecord): boolean {
  return r.corridor_load_lat != null && r.corridor_load_lng != null;
}

function hasCorridorCoords(r: MeridianCargoRecord): boolean {
  return (
    hasLoadCoords(r) &&
    r.corridor_discharge_lat != null &&
    r.corridor_discharge_lng != null
  );
}

function isPartialCorridor(r: MeridianCargoRecord): boolean {
  return hasLoadCoords(r) && !hasCorridorCoords(r);
}

const partialCorridorIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px dashed #fff;box-shadow:0 0 6px rgba(245,158,11,.8)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

type Props = {
  enabled: boolean;
  /** Leaflet zoom — drives API LOD (trade flows country-pair when &lt; 8). */
  mapZoom?: number;
  productFilter?: string;
  terminalSearch?: string;
  layers?: OilLiveLayerVisibility;
  tradeFlowGroup?: 'company_pair' | 'country_pair';
  viewport?: MaritimeViewportBounds | null;
  /** When set, filters GET /coverage to these open AIS sources (e.g. barentswatch). */
  coverageSources?: readonly string[];
  onStatsChange?: (stats: {
    terminals: number;
    vessels: number;
    opportunities: number;
    corridors: number;
    vesselMeta?: import('../../api/oilLiveApi').OilLiveVesselMeta | null;
  }) => void;
  onEntityClick?: (payload: OilLiveEntityClickPayload) => void;
};

type SanctionsTone = 'clear' | 'flagged' | 'review' | 'unknown';

function sanctionsTone(value?: string | null): SanctionsTone {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (v === 'clear') return 'clear';
  if (v === 'flagged' || v === 'sanctioned' || v === 'match') return 'flagged';
  if (v === 'review' || v === 'pep') return 'review';
  return 'unknown';
}

const SANCTIONS_STYLE: Record<SanctionsTone, { bg: string; color: string; label: string }> = {
  clear: { bg: '#dcfce7', color: '#166534', label: 'Sanctions: clear' },
  flagged: { bg: '#fee2e2', color: '#991b1b', label: 'Sanctions: flagged' },
  review: { bg: '#fef3c7', color: '#92400e', label: 'Sanctions: review' },
  unknown: { bg: '#e2e8f0', color: '#475569', label: 'Sanctions: unknown' },
};

function chipStyle(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 999,
    background: bg,
    color,
    fontSize: 9,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginRight: 4,
    marginBottom: 2,
  };
}

function LeiChip({ lei }: { lei?: string | null }) {
  if (!lei) return null;
  return (
    <span style={chipStyle('#dbeafe', '#1e3a8a')} title={`LEI ${lei}`}>
      LEI {lei.slice(0, 8)}…
    </span>
  );
}

function SanctionsChip({ status }: { status?: string | null }) {
  const tone = sanctionsTone(status);
  const style = SANCTIONS_STYLE[tone];
  return (
    <span style={chipStyle(style.bg, style.color)} title={style.label}>
      {tone === 'unknown' ? 'unscreened' : tone}
    </span>
  );
}

const RECIPE_TITLES: Record<string, string> = {
  A: 'Sanctions-pivot corridor (commodity x recent port-call switch)',
  B: 'Storage-build inferred lift (terminal level changes)',
  C: 'Tender-driven (USAspending / TED contract win + lift)',
  D: 'Refiner stock draw → import pull',
  E: 'Pipeline outage / disruption substitution',
  F: 'Export-quota window (Comtrade / Census signal)',
  G: 'Refinery-driven (EIA throughput + Comtrade feedstock)',
};

function recipeLabel(recipe?: string | null): { code: string; title: string } | null {
  if (!recipe) return null;
  const match = /[A-G]/i.exec(recipe);
  const code = match ? match[0].toUpperCase() : recipe;
  const title = RECIPE_TITLES[code] ?? recipe;
  return { code, title };
}

function formatVolumeBand(record: MeridianCargoRecord): string | null {
  const unit = record.volume_unit ?? 'bbl';
  const low = record.volume_low;
  const mid = record.volume_best_estimate;
  const high = record.volume_high;
  const parts: string[] = [];
  if (low != null) parts.push(Math.round(low).toLocaleString());
  if (mid != null) parts.push(mid != null ? `≈${Math.round(mid).toLocaleString()}` : '—');
  if (high != null) parts.push(Math.round(high).toLocaleString());
  if (parts.length === 0) return null;
  return `${parts.join(' – ')} ${unit}`;
}

/**
 * Renders a curved 3-point Polyline with an arrowhead near the discharge end.
 * Uses leaflet-polylinedecorator under the hood; if the decorator fails to
 * register (e.g. SSR/test), the polyline still renders without the arrow.
 */
type ArrowPolylineProps = {
  positions: LatLngTuple[];
  pathOptions: L.PathOptions;
  arrowColor: string;
  arrowSize: number;
  children?: React.ReactNode;
  eventHandlers?: L.LeafletEventHandlerFnMap;
};

function ArrowPolyline({
  positions,
  pathOptions,
  arrowColor,
  arrowSize,
  children,
  eventHandlers,
}: ArrowPolylineProps) {
  const map = useMap();
  const [polyline, setPolyline] = useState<L.Polyline | null>(null);

  useEffect(() => {
    if (!polyline) return;
    const decoratorFactory = (L as unknown as { polylineDecorator?: typeof L.polylineDecorator })
      .polylineDecorator;
    if (typeof decoratorFactory !== 'function') return;
    let decorator: L.PolylineDecorator;
    try {
      decorator = decoratorFactory(polyline, {
        patterns: [
          {
            offset: '100%',
            repeat: 0,
            symbol: L.Symbol.arrowHead({
              pixelSize: arrowSize,
              polygon: false,
              pathOptions: {
                stroke: true,
                color: arrowColor,
                weight: Math.max(2, Math.min(4, (pathOptions.weight ?? 2))),
                opacity: pathOptions.opacity ?? 1,
              },
            }),
          },
        ],
      });
    } catch {
      return;
    }
    decorator.addTo(map);
    return () => {
      decorator.remove();
    };
  }, [map, polyline, arrowColor, arrowSize, pathOptions.opacity, pathOptions.weight, positions]);

  return (
    <Polyline
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
      ref={(instance) => {
        setPolyline((current) => (current === instance ? current : instance ?? null));
      }}
    >
      {children}
    </Polyline>
  );
}

function OilLiveMapOverlays({
  enabled,
  mapZoom = 5,
  productFilter = 'all',
  terminalSearch = '',
  layers = LIVE_DATA_DEFAULT_LAYERS,
  tradeFlowGroup = 'company_pair',
  viewport,
  coverageSources,
  onStatsChange,
  onEntityClick,
}: Props) {
  const queryClient = useQueryClient();
  const [liveVessels, setLiveVessels] = useState<Record<number, OilLiveVessel>>({});
  const bbox = viewport
    ? `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`
    : undefined;

  const viewportReady = Boolean(bbox);
  const mapLayersActive = layers.terminals || layers.vessels;
  const effectiveTradeFlowGroup: 'company_pair' | 'country_pair' =
    mapZoom < 8 ? 'country_pair' : tradeFlowGroup;
  const oppQueryKey = ['oil-live-opportunities', 0.55] as const;

  const { data: mapData } = useQuery({
    queryKey: ['oil-live-map', bbox, Math.floor(mapZoom)],
    queryFn: () => getOilLiveMap(bbox, mapZoom),
    enabled: enabled && viewportReady && mapLayersActive,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled && viewportReady && mapLayersActive ? 30_000 : false,
  });

  const { data: coverageData } = useQuery({
    queryKey: ['oil-live-coverage', bbox, Math.floor(mapZoom), coverageSources?.join(',') ?? 'all'],
    queryFn: () =>
      getOilLiveCoverage({
        bbox: bbox!,
        freshness_minutes: 180,
        sources: coverageSources?.length ? [...coverageSources] : undefined,
      }),
    enabled: enabled && viewportReady && layers.coverage,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchInterval: enabled && viewportReady && layers.coverage ? 60_000 : false,
  });

  const { data: cargoData } = useQuery({
    queryKey: ['oil-live-cargo-map', bbox, productFilter, Math.floor(mapZoom)],
    queryFn: () =>
      getCargoRecordsMap(bbox!, {
        commodity: productFilter === 'all' ? undefined : productFilter,
        min_confidence: 0.6,
        limit: 200,
        zoom: mapZoom,
      }),
    enabled: enabled && layers.corridors && viewportReady,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: tradeFlowsData } = useQuery({
    queryKey: ['oil-live-trade-flows', effectiveTradeFlowGroup, productFilter, Math.floor(mapZoom)],
    queryFn: () =>
      getTradeFlows({
        group: effectiveTradeFlowGroup,
        commodity: productFilter === 'all' ? undefined : productFilter,
        min_confidence: 0.55,
        limit: mapZoom < 8 ? 80 : 200,
        zoom: mapZoom,
      }),
    enabled: enabled && layers.tradeFlows,
    staleTime: 120_000,
  });

  const { data: oppsData } = useQuery({
    queryKey: oppQueryKey,
    queryFn: () => getOilOpportunities(0.55),
    enabled: enabled && layers.opportunities,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!enabled || !layers.vessels) return;
    const disconnect = connectOilLiveWebSocket((msg) => {
      if (msg.type === 'vessel_position' && msg.data && typeof msg.data === 'object') {
        const d = msg.data as OilLiveVessel;
        if (d.mmsi) {
          setLiveVessels((prev) => ({ ...prev, [d.mmsi]: { ...prev[d.mmsi], ...d } }));
        }
      }
      if (msg.type === 'intelligence_card_created') {
        void queryClient.invalidateQueries({ queryKey: ['oil-live-map'] });
      }
    });
    return disconnect;
  }, [enabled, layers.vessels, queryClient]);

  const terminals = useMemo(() => {
    let list = mapData?.terminals ?? [];
    if (productFilter !== 'all') {
      list = list.filter((t) =>
        (t.products ?? []).some((p) => p.toLowerCase().includes(productFilter)),
      );
    }
    if (terminalSearch.trim()) {
      list = list.filter((t) => terminalMatchesSearch(t, terminalSearch));
    }
    return list.filter(
      (t) => t.lat != null && t.lng != null && inViewport(t.lat!, t.lng!, viewport),
    );
  }, [mapData?.terminals, productFilter, terminalSearch, viewport]);

  const vessels = useMemo(() => {
    const base = mapData?.vessels ?? [];
    const merged = base.map((v) => ({ ...v, ...liveVessels[v.mmsi] }));
    const extra = Object.values(liveVessels).filter(
      (v) => !base.some((b) => b.mmsi === v.mmsi),
    );
    return [...merged, ...extra].filter(
      (v) => v.lat != null && v.lng != null && inViewport(v.lat, v.lng, viewport),
    );
  }, [mapData?.vessels, liveVessels, viewport]);

  const filteredCargoRecords = useMemo(() => {
    return (cargoData?.cargo_records ?? []).filter((r) =>
      commodityMatchesFilter(r.commodity_family, productFilter),
    );
  }, [cargoData?.cargo_records, productFilter]);

  type Corridor = {
    record: MeridianCargoRecord;
    id: string;
    load: LatLngTuple;
    discharge: LatLngTuple;
    offsetIdx: number;
    positions: LatLngTuple[];
  };

  const corridors: Corridor[] = useMemo(() => {
    const filtered = filteredCargoRecords
      .filter(hasCorridorCoords)
      .filter((r) => {
        const load: LatLngTuple = [r.corridor_load_lat!, r.corridor_load_lng!];
        const disc: LatLngTuple = [r.corridor_discharge_lat!, r.corridor_discharge_lng!];
        return inViewport(load[0], load[1], viewport) || inViewport(disc[0], disc[1], viewport);
      });

    // Stagger arrows that share the same load/discharge pair so they don't stack.
    const seen = new Map<string, number>();
    const out: Corridor[] = [];
    for (const r of filtered) {
      const load: LatLngTuple = [r.corridor_load_lat!, r.corridor_load_lng!];
      const disc: LatLngTuple = [r.corridor_discharge_lat!, r.corridor_discharge_lng!];
      const key = `${load[0].toFixed(2)},${load[1].toFixed(2)}|${disc[0].toFixed(2)},${disc[1].toFixed(2)}`;
      const offsetIdx = seen.get(key) ?? 0;
      seen.set(key, offsetIdx + 1);
      out.push({
        record: r,
        id: r.id,
        load,
        discharge: disc,
        offsetIdx,
        positions: bezierMidpoint(load, disc, offsetIdx),
      });
      if (out.length >= MAX_PER_MCR_ARROWS) break;
    }
    return out;
  }, [filteredCargoRecords, viewport]);

  const partialCorridors = useMemo(() => {
    return filteredCargoRecords
      .filter((r) => isPartialCorridor(r))
      .filter((r) => inViewport(r.corridor_load_lat!, r.corridor_load_lng!, viewport));
  }, [filteredCargoRecords, viewport]);

  const tradeFlowArcs = useMemo(() => {
    const arcs = tradeFlowsData?.arcs ?? [];
    const seen = new Map<string, number>();
    const out: Array<TradeFlowArc & { offsetIdx: number; positions: LatLngTuple[] }> = [];
    for (const arc of arcs) {
      if (
        arc.origin_lat == null ||
        arc.origin_lng == null ||
        arc.dest_lat == null ||
        arc.dest_lng == null
      ) {
        continue;
      }
      if (
        !inViewport(arc.origin_lat, arc.origin_lng, viewport) &&
        !inViewport(arc.dest_lat, arc.dest_lng, viewport)
      ) {
        continue;
      }
      const load: LatLngTuple = [arc.origin_lat, arc.origin_lng];
      const disc: LatLngTuple = [arc.dest_lat, arc.dest_lng];
      const key = `${load[0].toFixed(2)},${load[1].toFixed(2)}|${disc[0].toFixed(2)},${disc[1].toFixed(2)}`;
      const offsetIdx = seen.get(key) ?? 0;
      seen.set(key, offsetIdx + 1);
      out.push({ ...arc, offsetIdx, positions: bezierMidpoint(load, disc, offsetIdx) });
      if (out.length >= MAX_TRADE_FLOW_ARROWS) break;
    }
    return out;
  }, [tradeFlowsData?.arcs, viewport]);

  const terminalById = useMemo(() => {
    const m = new Map<string, OilTerminal>();
    for (const t of mapData?.terminals ?? []) m.set(t.id, t);
    return m;
  }, [mapData?.terminals]);

  const dedupedOpportunities = useMemo(
    () => dedupeOpportunities(oppsData?.opportunities ?? [], 30),
    [oppsData?.opportunities],
  );

  const opportunityMarkers = useMemo(() => {
    const opps = dedupedOpportunities;
    const out: Array<{ key: string; lat: number; lng: number; title: string; oppId: string }> = [];
    for (const opp of opps) {
      const tid = opp.terminal_id;
      if (!tid) continue;
      const term = terminalById.get(tid);
      if (!term || term.lat == null || term.lng == null) continue;
      if (!inViewport(term.lat, term.lng, viewport)) continue;
      out.push({
        key: opp.id,
        oppId: opp.id,
        lat: term.lat,
        lng: term.lng,
        title: opp.title ?? 'Opportunity',
      });
    }
    return out;
  }, [dedupedOpportunities, terminalById, viewport]);

  const opportunityByTerminalId = useMemo(() => {
    const m = new Map<string, OilOpportunity>();
    for (const opp of dedupedOpportunities) {
      if (opp.terminal_id && !m.has(opp.terminal_id)) {
        m.set(opp.terminal_id, opp);
      }
    }
    return m;
  }, [dedupedOpportunities]);

  useEffect(() => {
    if (!onStatsChange) return;
    onStatsChange({
      terminals: terminals.length,
      vessels: vessels.length,
      opportunities: opportunityMarkers.length,
      corridors: corridors.length,
      vesselMeta: mapData?.vessel_meta ?? null,
    });
  }, [
    terminals.length,
    vessels.length,
    opportunityMarkers.length,
    corridors.length,
    mapData?.vessel_meta,
    onStatsChange,
  ]);

  const terminalClusterIcon = useMemo(() => createOilTerminalClusterIconFactory(), []);

  if (!enabled) return null;

  return (
    <LayerGroup>
      {layers.coverage &&
        (coverageData?.coverage_cells ?? []).map((cell: OilLiveCoverageCell) => (
          <Rectangle
            key={`coverage-${cell.cell_id}`}
            bounds={[
              [cell.min_lat, cell.min_lng],
              [cell.max_lat, cell.max_lng],
            ]}
            pathOptions={coveragePathOptions(cell.coverage_quality)}
            interactive
          >
            <Popup>
              <div className="oil-live-popup-body">
                <OilLiveProvenanceBadge kind="macro" className="mb-1" />
                <strong>AIS coverage: {cell.coverage_quality.replaceAll('_', ' ')}</strong>
                <p>{cell.vessel_count} vessels observed in this open-data cell</p>
                <p className="oil-live-popup-muted">
                  {cell.sources?.length ? `Sources: ${cell.sources.join(', ')}` : 'Open AIS observations'}
                </p>
                <p className="oil-live-popup-muted">
                  Sparse or empty cells mean a coverage gap, not confirmed vessel absence.
                </p>
              </div>
            </Popup>
          </Rectangle>
        ))}
      {layers.coverage &&
        (coverageData?.watch_zones ?? []).map((zone: OilLiveWatchZone) => (
          <Rectangle
            key={`watch-${zone.id}`}
            bounds={[
              [zone.min_lat, zone.min_lng],
              [zone.max_lat, zone.max_lng],
            ]}
            pathOptions={coveragePathOptions(zone.coverage_quality)}
            interactive
          >
            <Popup>
              <div className="oil-live-popup-body">
                <OilLiveProvenanceBadge kind="inferred" className="mb-1" />
                <strong>{zone.name}</strong>
                <p>
                  {zone.recent_vessel_count ?? 0} recent open AIS vessels ·{' '}
                  {zone.coverage_quality.replaceAll('_', ' ')}
                </p>
                {zone.expected_gap_reason && (
                  <p className="oil-live-popup-muted">{zone.expected_gap_reason}</p>
                )}
                <p className="oil-live-popup-muted">
                  Watch zones guide receiver rollout and port-event fallback priority.
                </p>
              </div>
            </Popup>
          </Rectangle>
        ))}
      {layers.terminals && terminals.length > 0 && (
        <MarkerClusterGroup
          showCoverageOnHover={false}
          chunkedLoading
          maxClusterRadius={42}
          disableClusteringAtZoom={11}
          spiderfyOnMaxZoom
          zoomToBoundsOnClick
          iconCreateFunction={terminalClusterIcon}
          spiderLegPolylineOptions={{ interactive: false }}
        >
          {terminals.map((term) => (
            <Marker
              key={term.id}
              position={[term.lat!, term.lng!]}
              icon={terminalIcon}
              eventHandlers={{
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                },
              }}
            >
              <Popup className="oil-live-leaflet-popup">
                <div className="oil-live-popup-body">
                  <strong>{term.name}</strong>
                  <p>{term.operator_name}</p>
                  <p>{(term.products ?? []).slice(0, 4).join(', ')}</p>
                  {term.country && <p className="oil-live-popup-muted">{term.country}</p>}
                  {onEntityClick && (
                    <>
                      <button
                        type="button"
                        className="oil-live-popup-btn"
                        onClick={() =>
                          onEntityClick({
                            entityKind: 'terminal',
                            entityId: term.id,
                            opportunityId: opportunityByTerminalId.get(term.id)?.id,
                            title: term.name,
                            subtitle: [term.operator_name, term.country].filter(Boolean).join(' · '),
                          })
                        }
                      >
                        View details
                      </button>
                      <button
                        type="button"
                        className="oil-live-popup-btn oil-live-popup-btn--outline"
                        onClick={() =>
                          onEntityClick({
                            entityKind: 'terminal',
                            entityId: term.id,
                            opportunityId: opportunityByTerminalId.get(term.id)?.id,
                            title: term.name,
                            subtitle: [term.operator_name, term.country].filter(Boolean).join(' · '),
                            initialDrawerTab: 'workflow',
                          })
                        }
                      >
                        Trading workflow
                      </button>
                    </>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      )}
      {layers.vessels &&
        vessels.map((v) => (
          <Marker
            key={v.mmsi}
            position={[v.lat, v.lng]}
            icon={vesselIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
              },
            }}
          >
            <Popup>
              <OilLiveProvenanceBadge kind={v.source ?? v.data_source ?? 'live_ais'} className="mb-1" />
              <strong>{v.name ?? `MMSI ${v.mmsi}`}</strong>
              <br />
              {v.tanker_class}
              {v.source_type && (
                <>
                  <br />
                  <span className="oil-live-popup-muted">{v.source_type.replaceAll('_', ' ')}</span>
                </>
              )}
              {v.freshness_seconds != null && (
                <>
                  <br />
                  <span className="oil-live-popup-muted">
                    Freshness: {Math.round(v.freshness_seconds / 60)} min
                  </span>
                </>
              )}
              <br />
              <span className="oil-live-popup-muted">
                AIS does not confirm supplier or receiver.
              </span>
              {onEntityClick && (
                <button
                  type="button"
                  className="oil-live-popup-btn"
                  onClick={() =>
                    onEntityClick({
                      entityKind: 'vessel',
                      entityId: String(v.mmsi),
                      title: v.name ?? `MMSI ${v.mmsi}`,
                      subtitle: v.tanker_class,
                    })
                  }
                >
                  View details
                </button>
              )}
            </Popup>
          </Marker>
        ))}
      {layers.corridors &&
        partialCorridors.map((r) => (
          <Marker
            key={`partial-${r.id}`}
            position={[r.corridor_load_lat!, r.corridor_load_lng!]}
            icon={partialCorridorIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
              },
            }}
          >
            <Popup>
              <span
                style={{
                  display: 'inline-block',
                  marginBottom: 4,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                partial corridor
              </span>
              <br />
              <strong>{r.commodity_family ?? 'Cargo'}</strong>
              <br />
              Load: {r.load_port_name ?? '—'}
              {r.discharge_hint && (
                <>
                  <br />
                  Discharge hint: {r.discharge_hint}
                </>
              )}
              {onEntityClick && (
                <button
                  type="button"
                  className="oil-live-popup-btn"
                  onClick={() =>
                    onEntityClick({
                      entityKind: 'cargo',
                      entityId: r.id,
                      title: r.vessel_name ?? `Cargo ${r.commodity_family ?? ''}`,
                      subtitle: [r.load_port_name, r.discharge_hint ?? 'discharge unknown']
                        .filter(Boolean)
                        .join(' → '),
                    })
                  }
                >
                  View details
                </button>
              )}
            </Popup>
          </Marker>
        ))}
      {layers.corridors &&
        corridors.map((c) => {
          const color = commodityColor(c.record.commodity_family);
          const weight = volumeToWeight(c.record.volume_best_estimate);
          const opacity = recencyOpacity(c.record.event_date ?? c.record.created_at);
          const dash = tierDashArray(
            c.record.bol_tier,
            c.record.data_provenance,
            c.record.triangulation_score,
          );
          const doubleStroke = tierDoubleStroke(c.record.triangulation_score);
          const arrowSize = Math.max(8, Math.min(14, Math.round(weight + 6)));
          const volumeBand = formatVolumeBand(c.record);
          const recipe = recipeLabel(c.record.recipe);
          const evidenceTop = (c.record.evidence_chain ?? []).slice(0, 2);
          const sources = c.record.sources ?? [];
          const onClickPopup = (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
          };

          return (
            <LayerGroup key={c.id}>
              {doubleStroke && (
                <Polyline
                  positions={c.positions}
                  pathOptions={{
                    color,
                    weight: weight + 4,
                    opacity: opacity * 0.35,
                    dashArray: undefined,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                  interactive={false}
                />
              )}
              <ArrowPolyline
                positions={c.positions}
                arrowColor={color}
                arrowSize={arrowSize}
                pathOptions={{
                  color,
                  weight,
                  opacity,
                  dashArray: dash,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
                eventHandlers={{ click: onClickPopup }}
              >
                <Popup>
                  <div style={{ minWidth: 220, maxWidth: 280 }}>
                    <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      <OilLiveProvenanceBadge kind={c.record.data_provenance ?? 'synthetic'} />
                      {c.record.bol_tier && (
                        <span style={chipStyle('#f1f5f9', '#0f172a')}>{c.record.bol_tier}</span>
                      )}
                      {recipe && (
                        <span
                          style={chipStyle('#ede9fe', '#5b21b6')}
                          title={recipe.title}
                        >
                          Recipe {recipe.code}
                        </span>
                      )}
                    </div>
                    <strong>{c.record.commodity_family ?? 'Cargo corridor'}</strong>
                    <br />
                    {c.record.shipper_name && (
                      <>
                        Shipper: {c.record.shipper_name}
                        <br />
                      </>
                    )}
                    {c.record.consignee_name && (
                      <>
                        Consignee: {c.record.consignee_name}
                        <br />
                      </>
                    )}
                    {c.record.load_port_name && (
                      <>
                        Load: {c.record.load_port_name}
                        <br />
                      </>
                    )}
                    {(c.record.discharge_hint || c.record.discharge_country) && (
                      <>
                        Discharge: {c.record.discharge_hint ?? c.record.discharge_country}
                        <br />
                      </>
                    )}
                    {volumeBand && (
                      <>
                        Volume: {volumeBand}
                        {c.record.volume_method && (
                          <span
                            style={{
                              ...chipStyle('#e0f2fe', '#075985'),
                              marginLeft: 4,
                            }}
                          >
                            {c.record.volume_method}
                          </span>
                        )}
                        <br />
                      </>
                    )}
                    {c.record.confidence != null && (
                      <>
                        Confidence: {(c.record.confidence * 100).toFixed(0)}%
                        <br />
                      </>
                    )}

                    {(c.record.shipper_lei ||
                      c.record.consignee_lei ||
                      c.record.shipper_sanctions_status ||
                      c.record.consignee_sanctions_status) && (
                      <div style={{ marginTop: 6 }}>
                        {(c.record.shipper_lei || c.record.shipper_sanctions_status) && (
                          <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>
                            <span style={{ fontWeight: 800 }}>Shipper: </span>
                            <LeiChip lei={c.record.shipper_lei} />
                            <SanctionsChip status={c.record.shipper_sanctions_status} />
                          </div>
                        )}
                        {(c.record.consignee_lei || c.record.consignee_sanctions_status) && (
                          <div style={{ fontSize: 9, color: '#475569' }}>
                            <span style={{ fontWeight: 800 }}>Consignee: </span>
                            <LeiChip lei={c.record.consignee_lei} />
                            <SanctionsChip status={c.record.consignee_sanctions_status} />
                          </div>
                        )}
                      </div>
                    )}

                    {evidenceTop.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <p
                          style={{
                            fontSize: 9,
                            fontWeight: 800,
                            color: '#475569',
                            textTransform: 'uppercase',
                            margin: '0 0 2px',
                          }}
                        >
                          Evidence
                        </p>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 14,
                            fontSize: 10,
                            color: '#334155',
                          }}
                        >
                          {evidenceTop.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {sources.length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 10 }}>
                        <span style={{ fontWeight: 800, color: '#475569' }}>Verify source: </span>
                        {sources
                          .filter((s) => s?.url)
                          .slice(0, 3)
                          .map((s, i) => (
                            <a
                              key={i}
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                color: '#0369a1',
                                marginRight: 6,
                                textDecoration: 'underline',
                              }}
                            >
                              {s.name ?? `#${i + 1}`}
                            </a>
                          ))}
                      </div>
                    )}
                    {onEntityClick && (
                      <button
                        type="button"
                        className="oil-live-popup-btn"
                        onClick={() =>
                          onEntityClick({
                            entityKind: 'cargo',
                            entityId: c.id,
                            title:
                              c.record.vessel_name ?? `Cargo ${c.record.commodity_family ?? ''}`,
                            subtitle: [c.record.load_port_name, c.record.discharge_hint]
                              .filter(Boolean)
                              .join(' → '),
                          })
                        }
                      >
                        View details
                      </button>
                    )}
                  </div>
                </Popup>
              </ArrowPolyline>
            </LayerGroup>
          );
        })}
      {layers.tradeFlows &&
        tradeFlowArcs.map((arc) => {
          const color = commodityColor(arc.commodity_family);
          const weight = Math.max(
            2,
            Math.min(10, 2 + 2.5 * Math.log10(Math.max(1, arc.cargo_count))),
          );
          const opacity = Math.max(0.45, Math.min(0.95, 0.45 + arc.avg_confidence * 0.5));
          const arrowSize = Math.max(10, Math.min(16, Math.round(weight + 6)));
          return (
            <ArrowPolyline
              key={`tf-${arc.key}`}
              positions={arc.positions}
              arrowColor={color}
              arrowSize={arrowSize}
              pathOptions={{
                color,
                weight,
                opacity,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            >
              <Popup>
                <div style={{ minWidth: 220, maxWidth: 280 }}>
                  <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <span style={chipStyle('#fef3c7', '#92400e')}>Trade flow</span>
                    <span style={chipStyle('#e0f2fe', '#075985')}>
                      {arc.group === 'company_pair' ? 'Company pair' : 'Country pair'}
                    </span>
                    <span style={chipStyle('#ede9fe', '#5b21b6')}>{arc.commodity_family}</span>
                  </div>
                  <strong>
                    {arc.shipper} → {arc.consignee}
                  </strong>
                  <br />
                  <span style={{ fontSize: 11 }}>
                    {arc.cargo_count.toLocaleString()} cargo{arc.cargo_count === 1 ? '' : 'es'} ·{' '}
                    {Math.round(arc.volume_total).toLocaleString()} {arc.volume_unit || ''}
                  </span>
                  <br />
                  <span style={{ fontSize: 11 }}>
                    Confidence avg {(arc.avg_confidence * 100).toFixed(0)}%
                  </span>
                  {arc.sample_mcr_ids.length > 0 && onEntityClick && (
                    <div style={{ marginTop: 6 }}>
                      <p
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          color: '#475569',
                          textTransform: 'uppercase',
                          margin: '0 0 2px',
                        }}
                      >
                        Contributing cargoes
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {arc.sample_mcr_ids.slice(0, 5).map((mcrId) => (
                          <button
                            key={mcrId}
                            type="button"
                            onClick={() =>
                              onEntityClick({
                                entityKind: 'cargo',
                                entityId: mcrId,
                                title: `MCR ${mcrId.slice(0, 8)}`,
                                subtitle: `${arc.shipper} → ${arc.consignee}`,
                              })
                            }
                            style={{
                              border: '1px solid #cbd5e1',
                              borderRadius: 4,
                              background: '#f8fafc',
                              padding: '2px 6px',
                              fontSize: 9,
                              fontFamily: 'monospace',
                              cursor: 'pointer',
                            }}
                          >
                            {mcrId.slice(0, 8)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Popup>
            </ArrowPolyline>
          );
        })}
      {layers.opportunities &&
        opportunityMarkers.map((o) => (
          <Marker
            key={o.key}
            position={[o.lat, o.lng]}
            icon={oppIcon}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e);
              },
            }}
          >
            <Popup>
              {o.title}
              {onEntityClick && (
                <>
                  <button
                    type="button"
                    className="oil-live-popup-btn"
                    onClick={() =>
                      onEntityClick({
                        entityKind: 'opportunity',
                        entityId: o.oppId,
                        opportunityId: o.oppId,
                        title: o.title,
                      })
                    }
                  >
                    View details
                  </button>
                  <button
                    type="button"
                    className="oil-live-popup-btn oil-live-popup-btn--outline"
                    onClick={() =>
                      onEntityClick({
                        entityKind: 'opportunity',
                        entityId: o.oppId,
                        opportunityId: o.oppId,
                        title: o.title,
                        initialDrawerTab: 'workflow',
                      })
                    }
                  >
                    Trading workflow
                  </button>
                </>
              )}
            </Popup>
          </Marker>
        ))}
    </LayerGroup>
  );
}

export default memo(OilLiveMapOverlays);
