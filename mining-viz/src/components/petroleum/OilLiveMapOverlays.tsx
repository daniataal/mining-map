import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Popup, Rectangle, LayerGroup } from 'react-leaflet';
import L from 'leaflet';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
import OilLiveMapPopupController, {
  liveDealFeatureToPopupSnapshot,
  type OilLivePopupSnapshot,
} from './OilLiveMapPopupController';
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
import { dedupeOpportunities } from '../../features/live-data/dedupeOpportunities';
import { LIVE_DATA_DEFAULT_LAYERS } from '../../features/live-data/liveDataMapDefaults';
import type { LiveDataLensMode } from '../../features/live-data/liveDataMapDefaults';
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
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

export type { OilLiveEntityClickPayload } from './oilLiveEntityPayload';
import type { OilLiveEntityClickPayload } from './oilLiveEntityPayload';

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

type Props = {
  enabled: boolean;
  /** Leaflet zoom — drives API LOD (trade flows country-pair when &lt; 8). */
  mapZoom?: number;
  productFilter?: string;
  terminalSearch?: string;
  lensMode?: LiveDataLensMode;
  layers?: OilLiveLayerVisibility;
  tradeFlowGroup?: 'company_pair' | 'country_pair';
  viewport?: MaritimeViewportBounds | null;
  /** When set (maritime focus mode), only this MMSI is drawn on the Live Data vessel layer. */
  focusVesselMmsi?: number | null;
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

function OilLiveMapOverlays({
  enabled,
  mapZoom = 5,
  productFilter = 'all',
  terminalSearch = '',
  lensMode = 'deal',
  layers = LIVE_DATA_DEFAULT_LAYERS,
  tradeFlowGroup = 'company_pair',
  viewport,
  focusVesselMmsi = null,
  coverageSources,
  onStatsChange,
  onEntityClick,
}: Props) {
  const queryClient = useQueryClient();
  const [liveVessels, setLiveVessels] = useState<Record<number, OilLiveVessel>>({});
  const [popupSnapshot, setPopupSnapshot] = useState<OilLivePopupSnapshot | null>(null);

  const handleCanvasFeatureClick = useCallback((feature: LiveDealMapFeature) => {
    setPopupSnapshot(liveDealFeatureToPopupSnapshot(feature));
  }, []);
  const bbox = viewport
    ? `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`
    : undefined;

  const viewportReady = Boolean(bbox);
  const mapLayersActive = layers.terminals || layers.vessels;
  const effectiveTradeFlowGroup: 'company_pair' | 'country_pair' =
    mapZoom < 8 ? 'country_pair' : tradeFlowGroup;
  const oppQueryKey = ['oil-live-opportunities', 0.55, productFilter] as const;

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
    queryFn: () =>
      getOilOpportunities(0.55, {
        commodity: productFilter === 'all' ? undefined : productFilter,
        min_deal_score: 0.45,
        limit: 80,
      }),
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
    let list = [...merged, ...extra].filter(
      (v) => v.lat != null && v.lng != null && inViewport(v.lat, v.lng, viewport),
    );
    if (focusVesselMmsi != null && Number.isFinite(focusVesselMmsi)) {
      list = list.filter((v) => v.mmsi === focusVesselMmsi);
    }
    return list;
  }, [mapData?.vessels, liveVessels, viewport, focusVesselMmsi]);

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

  const dealConnectorTerminalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const opp of dedupedOpportunities) {
      if (opp.terminal_id) ids.add(opp.terminal_id);
    }
    for (const record of filteredCargoRecords) {
      const terminalId = (record as MeridianCargoRecord & { load_terminal_id?: string }).load_terminal_id;
      if (terminalId) ids.add(terminalId);
    }
    return ids;
  }, [dedupedOpportunities, filteredCargoRecords]);

  const dealConnectorMmsis = useMemo(() => {
    const ids = new Set<number>();
    for (const opp of dedupedOpportunities) {
      if (typeof opp.mmsi === 'number') ids.add(opp.mmsi);
    }
    for (const record of filteredCargoRecords) {
      if (typeof record.mmsi === 'number') ids.add(record.mmsi);
    }
    return ids;
  }, [dedupedOpportunities, filteredCargoRecords]);

  const visibleTerminalCount =
    lensMode === 'deal'
      ? terminals.filter((term) => dealConnectorTerminalIds.has(term.id)).length
      : terminals.length;

  const visibleVesselCount =
    lensMode === 'deal'
      ? vessels.filter((vessel) => dealConnectorMmsis.has(vessel.mmsi)).length
      : vessels.length;

  const canvasFeatures = useMemo<LiveDealMapFeature[]>(() => {
    const features: LiveDealMapFeature[] = [];

    if (layers.corridors) {
      for (const c of corridors) {
        const color = commodityColor(c.record.commodity_family);
        const baseWeight = volumeToWeight(c.record.volume_best_estimate);
        const weight =
          baseWeight +
          (tierDoubleStroke(c.record.triangulation_score) ? 1.5 : 0);
        const opacity = recencyOpacity(c.record.event_date ?? c.record.created_at);
        features.push({
          shape: 'arc',
          uid: `cargo-arc:${c.id}`,
          id: c.id,
          kind: 'cargo',
          positions: c.positions,
          popupLat: c.positions[1]?.[0] ?? c.load[0],
          popupLng: c.positions[1]?.[1] ?? c.load[1],
          title: c.record.vessel_name ?? `Cargo ${c.record.commodity_family ?? ''}`,
          subtitle: [c.record.load_port_name, c.record.discharge_hint]
            .filter(Boolean)
            .join(' → '),
          tier: c.record.data_provenance ?? c.record.bol_tier ?? 'synthetic',
          confidence: c.record.confidence,
          sourceCount: c.record.sources?.length ?? c.record.evidence_chain?.length ?? 0,
          dealScore: (c.record.triangulation_score ?? 0) / 100,
          styleKey: c.record.commodity_family ?? 'cargo',
          color,
          weight,
          opacity,
          dashArray: tierDashArray(
            c.record.bol_tier,
            c.record.data_provenance,
            c.record.triangulation_score,
          ),
          payload: {
            entityKind: 'cargo',
            entityId: c.id,
            title: c.record.vessel_name ?? `Cargo ${c.record.commodity_family ?? ''}`,
            subtitle: [c.record.load_port_name, c.record.discharge_hint]
              .filter(Boolean)
              .join(' → '),
          } satisfies OilLiveEntityClickPayload,
          data: c.record,
        });
      }

      for (const r of partialCorridors) {
        features.push({
          shape: 'point',
          uid: `cargo-point:${r.id}`,
          id: r.id,
          kind: 'cargo',
          lat: r.corridor_load_lat!,
          lng: r.corridor_load_lng!,
          title: r.vessel_name ?? `Cargo ${r.commodity_family ?? ''}`,
          subtitle: [r.load_port_name, r.discharge_hint ?? 'discharge unknown']
            .filter(Boolean)
            .join(' → '),
          tier: r.data_provenance ?? r.bol_tier ?? 'synthetic',
          confidence: r.confidence,
          sourceCount: r.sources?.length ?? r.evidence_chain?.length ?? 0,
          dealScore: (r.triangulation_score ?? 0) / 100,
          styleKey: r.commodity_family ?? 'partial-corridor',
          payload: {
            entityKind: 'cargo',
            entityId: r.id,
            title: r.vessel_name ?? `Cargo ${r.commodity_family ?? ''}`,
            subtitle: [r.load_port_name, r.discharge_hint ?? 'discharge unknown']
              .filter(Boolean)
              .join(' → '),
          } satisfies OilLiveEntityClickPayload,
          data: r,
        });
      }
    }

    if (layers.tradeFlows) {
      for (const arc of tradeFlowArcs) {
        const color = commodityColor(arc.commodity_family);
        const weight = Math.max(
          2,
          Math.min(10, 2 + 2.5 * Math.log10(Math.max(1, arc.cargo_count))),
        );
        const opacity = Math.max(0.45, Math.min(0.95, 0.45 + arc.avg_confidence * 0.5));
        features.push({
          shape: 'arc',
          uid: `trade-flow:${arc.key}`,
          id: arc.key,
          kind: 'trade_flow',
          positions: arc.positions,
          popupLat: arc.positions[1]?.[0] ?? arc.origin_lat,
          popupLng: arc.positions[1]?.[1] ?? arc.origin_lng,
          title: `${arc.shipper} → ${arc.consignee}`,
          subtitle: `${arc.cargo_count.toLocaleString()} cargo${arc.cargo_count === 1 ? '' : 'es'} · ${arc.commodity_family}`,
          tier: 'synthetic',
          confidence: arc.avg_confidence,
          sourceCount: arc.sample_mcr_ids.length,
          dealScore: arc.avg_confidence,
          styleKey: arc.commodity_family,
          color,
          weight,
          opacity,
          data: arc,
        });
      }
    }

    if (layers.terminals) {
      for (const term of terminals) {
        if (lensMode === 'deal' && !dealConnectorTerminalIds.has(term.id)) continue;
        const opportunity = opportunityByTerminalId.get(term.id);
        features.push({
          shape: 'point',
          uid: `terminal:${term.id}`,
          id: term.id,
          kind: 'terminal',
          lat: term.lat!,
          lng: term.lng!,
          title: term.name,
          subtitle: [term.operator_name, term.country].filter(Boolean).join(' · '),
          tier: 'inferred',
          confidence: term.confidence,
          sourceCount: (term.products ?? []).length,
          dealScore: opportunity?.confidence ?? term.confidence ?? 0,
          styleKey: term.terminal_type ?? 'terminal',
          payload: {
            entityKind: 'terminal',
            entityId: term.id,
            opportunityId: opportunity?.id,
            title: term.name,
            subtitle: [term.operator_name, term.country].filter(Boolean).join(' · '),
          } satisfies OilLiveEntityClickPayload,
          data: term,
        });
      }
    }

    if (layers.vessels) {
      for (const vessel of vessels) {
        if (lensMode === 'deal' && !dealConnectorMmsis.has(vessel.mmsi)) continue;
        features.push({
          shape: 'point',
          uid: `vessel:${vessel.mmsi}`,
          id: String(vessel.mmsi),
          kind: 'vessel',
          lat: vessel.lat,
          lng: vessel.lng,
          heading: vessel.course ?? 0,
          title: vessel.name ?? vessel.vessel_name ?? `MMSI ${vessel.mmsi}`,
          subtitle: vessel.tanker_class,
          tier: vessel.source ?? vessel.data_source ?? 'live_ais',
          confidence: vessel.confidence,
          sourceCount: vessel.source_url ? 1 : 0,
          dealScore: vessel.crude_capable || vessel.tanker_class ? 0.75 : 0.45,
          styleKey: vessel.tanker_class ?? 'vessel',
          payload: {
            entityKind: 'vessel',
            entityId: String(vessel.mmsi),
            title: vessel.name ?? vessel.vessel_name ?? `MMSI ${vessel.mmsi}`,
            subtitle: vessel.tanker_class,
          } satisfies OilLiveEntityClickPayload,
          data: vessel,
        });
      }
    }

    if (layers.opportunities) {
      for (const marker of opportunityMarkers) {
        const opportunity = dedupedOpportunities.find((opp) => opp.id === marker.oppId);
        features.push({
          shape: 'point',
          uid: `opportunity:${marker.oppId}`,
          id: marker.oppId,
          kind: 'opportunity',
          lat: marker.lat,
          lng: marker.lng,
          title: marker.title,
          subtitle: opportunity?.hypothesis,
          tier: opportunity?.source_tiers?.[0] ?? 'synthetic',
          confidence: opportunity?.confidence,
          sourceCount: opportunity?.evidence?.length ?? 0,
          dealScore: opportunity?.deal_score ?? opportunity?.confidence ?? 0.8,
          styleKey: 'deal_radar',
          payload: {
            entityKind: 'opportunity',
            entityId: marker.oppId,
            opportunityId: marker.oppId,
            title: marker.title,
          } satisfies OilLiveEntityClickPayload,
          data: { marker, opportunity },
        });
      }
    }

    return features;
  }, [
    corridors,
    dealConnectorMmsis,
    dealConnectorTerminalIds,
    dedupedOpportunities,
    lensMode,
    layers.corridors,
    layers.opportunities,
    layers.terminals,
    layers.tradeFlows,
    layers.vessels,
    opportunityByTerminalId,
    opportunityMarkers,
    partialCorridors,
    terminals,
    tradeFlowArcs,
    vessels,
  ]);

  useEffect(() => {
    if (!onStatsChange) return;
    onStatsChange({
      terminals: visibleTerminalCount,
      vessels: visibleVesselCount,
      opportunities: opportunityMarkers.length,
      corridors: corridors.length,
      vesselMeta: mapData?.vessel_meta ?? null,
    });
  }, [
    visibleTerminalCount,
    visibleVesselCount,
    opportunityMarkers.length,
    corridors.length,
    mapData?.vessel_meta,
    onStatsChange,
  ]);

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
                <strong>AIS coverage: {cell.coverage_quality.replace(/_/g, ' ')}</strong>
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
                  {zone.coverage_quality.replace(/_/g, ' ')}
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
      <CanvasLiveDealLayer
        features={canvasFeatures}
        mapZoom={mapZoom}
        selectedUid={popupSnapshot?.uid ?? null}
        onFeatureClick={handleCanvasFeatureClick}
      />
      <OilLiveMapPopupController
        snapshot={popupSnapshot}
        onClose={() => setPopupSnapshot(null)}
        onEntityClick={onEntityClick}
      />
    </LayerGroup>
  );
}

export default memo(OilLiveMapOverlays);
