import { memo, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Popup, Rectangle, LayerGroup } from 'react-leaflet';
import L from 'leaflet';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
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
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

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
  const [selectedFeature, setSelectedFeature] = useState<LiveDealMapFeature | null>(null);
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
          tier: 'synthetic',
          confidence: opportunity?.confidence,
          sourceCount: opportunity?.evidence?.length ?? 0,
          dealScore: opportunity?.confidence ?? 0.8,
          styleKey: opportunity?.opportunity_type ?? 'opportunity',
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
    dedupedOpportunities,
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
    if (!selectedFeature) return;
    if (!canvasFeatures.some((feature) => feature.uid === selectedFeature.uid)) {
      setSelectedFeature(null);
    }
  }, [canvasFeatures, selectedFeature]);

  const selectedPopupPosition: LatLngTuple | null = selectedFeature
    ? selectedFeature.shape === 'point'
      ? [selectedFeature.lat, selectedFeature.lng]
      : [selectedFeature.popupLat, selectedFeature.popupLng]
    : null;

  const openFeatureDetails = (
    payload: unknown,
    initialDrawerTab?: OilLiveDrawerTab,
  ): void => {
    if (!onEntityClick || !payload || typeof payload !== 'object') return;
    onEntityClick({
      ...(payload as OilLiveEntityClickPayload),
      ...(initialDrawerTab ? { initialDrawerTab } : {}),
    });
  };

  const renderSelectedPopup = () => {
    if (!selectedFeature) return null;

    if (selectedFeature.kind === 'terminal') {
      const term = selectedFeature.data as OilTerminal;
      return (
        <div className="oil-live-popup-body">
          <OilLiveProvenanceBadge kind="inferred" className="mb-1" />
          <strong>{term.name}</strong>
          <p>{term.operator_name}</p>
          <p>{(term.products ?? []).slice(0, 4).join(', ')}</p>
          {term.country && <p className="oil-live-popup-muted">{term.country}</p>}
          {onEntityClick && (
            <>
              <button
                type="button"
                className="oil-live-popup-btn"
                onClick={() => openFeatureDetails(selectedFeature.payload)}
              >
                View details
              </button>
              <button
                type="button"
                className="oil-live-popup-btn oil-live-popup-btn--outline"
                onClick={() => openFeatureDetails(selectedFeature.payload, 'workflow')}
              >
                Trading workflow
              </button>
            </>
          )}
        </div>
      );
    }

    if (selectedFeature.kind === 'vessel') {
      const vessel = selectedFeature.data as OilLiveVessel;
      return (
        <div className="oil-live-popup-body">
          <OilLiveProvenanceBadge
            kind={vessel.source ?? vessel.data_source ?? 'live_ais'}
            className="mb-1"
          />
          <strong>{vessel.name ?? vessel.vessel_name ?? `MMSI ${vessel.mmsi}`}</strong>
          <br />
          {vessel.tanker_class}
          {vessel.source_type && (
            <>
              <br />
              <span className="oil-live-popup-muted">{vessel.source_type.replaceAll('_', ' ')}</span>
            </>
          )}
          {vessel.freshness_seconds != null && (
            <>
              <br />
              <span className="oil-live-popup-muted">
                Freshness: {Math.round(vessel.freshness_seconds / 60)} min
              </span>
            </>
          )}
          <br />
          <span className="oil-live-popup-muted">AIS does not confirm supplier or receiver.</span>
          {onEntityClick && (
            <button
              type="button"
              className="oil-live-popup-btn"
              onClick={() => openFeatureDetails(selectedFeature.payload)}
            >
              View details
            </button>
          )}
        </div>
      );
    }

    if (selectedFeature.kind === 'opportunity') {
      const selected = selectedFeature.data as {
        opportunity?: OilOpportunity;
      };
      const opportunity = selected.opportunity;
      return (
        <div className="oil-live-popup-body">
          <OilLiveProvenanceBadge kind="synthetic" className="mb-1" />
          <strong>{selectedFeature.title}</strong>
          {opportunity?.confidence != null && (
            <p>Confidence {(opportunity.confidence * 100).toFixed(0)}%</p>
          )}
          {opportunity?.hypothesis && <p>{opportunity.hypothesis}</p>}
          {(opportunity?.evidence ?? []).slice(0, 2).map((line, index) => (
            <p key={index} className="oil-live-popup-muted">
              {line}
            </p>
          ))}
          {onEntityClick && (
            <>
              <button
                type="button"
                className="oil-live-popup-btn"
                onClick={() => openFeatureDetails(selectedFeature.payload)}
              >
                View details
              </button>
              <button
                type="button"
                className="oil-live-popup-btn oil-live-popup-btn--outline"
                onClick={() => openFeatureDetails(selectedFeature.payload, 'workflow')}
              >
                Trading workflow
              </button>
            </>
          )}
        </div>
      );
    }

    if (selectedFeature.kind === 'trade_flow') {
      const arc = selectedFeature.data as TradeFlowArc;
      return (
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
      );
    }

    const record = selectedFeature.data as MeridianCargoRecord;
    const volumeBand = formatVolumeBand(record);
    const recipe = recipeLabel(record.recipe);
    const evidenceTop = (record.evidence_chain ?? []).slice(0, 2);
    const sources = record.sources ?? [];
    return (
      <div style={{ minWidth: 220, maxWidth: 280 }}>
        <div style={{ marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <OilLiveProvenanceBadge kind={record.data_provenance ?? 'synthetic'} />
          {record.bol_tier && <span style={chipStyle('#f1f5f9', '#0f172a')}>{record.bol_tier}</span>}
          {recipe && (
            <span style={chipStyle('#ede9fe', '#5b21b6')} title={recipe.title}>
              Recipe {recipe.code}
            </span>
          )}
          {isPartialCorridor(record) && (
            <span style={chipStyle('#fef3c7', '#92400e')}>partial corridor</span>
          )}
        </div>
        <strong>{record.commodity_family ?? 'Cargo corridor'}</strong>
        <br />
        {record.shipper_name && (
          <>
            Shipper: {record.shipper_name}
            <br />
          </>
        )}
        {record.consignee_name && (
          <>
            Consignee: {record.consignee_name}
            <br />
          </>
        )}
        {record.load_port_name && (
          <>
            Load: {record.load_port_name}
            <br />
          </>
        )}
        {(record.discharge_hint || record.discharge_country) && (
          <>
            Discharge: {record.discharge_hint ?? record.discharge_country}
            <br />
          </>
        )}
        {volumeBand && (
          <>
            Volume: {volumeBand}
            {record.volume_method && (
              <span style={{ ...chipStyle('#e0f2fe', '#075985'), marginLeft: 4 }}>
                {record.volume_method}
              </span>
            )}
            <br />
          </>
        )}
        {record.confidence != null && (
          <>
            Confidence: {(record.confidence * 100).toFixed(0)}%
            <br />
          </>
        )}

        {(record.shipper_lei ||
          record.consignee_lei ||
          record.shipper_sanctions_status ||
          record.consignee_sanctions_status) && (
          <div style={{ marginTop: 6 }}>
            {(record.shipper_lei || record.shipper_sanctions_status) && (
              <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>
                <span style={{ fontWeight: 800 }}>Shipper: </span>
                <LeiChip lei={record.shipper_lei} />
                <SanctionsChip status={record.shipper_sanctions_status} />
              </div>
            )}
            {(record.consignee_lei || record.consignee_sanctions_status) && (
              <div style={{ fontSize: 9, color: '#475569' }}>
                <span style={{ fontWeight: 800 }}>Consignee: </span>
                <LeiChip lei={record.consignee_lei} />
                <SanctionsChip status={record.consignee_sanctions_status} />
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
            <ul style={{ margin: 0, paddingLeft: 14, fontSize: 10, color: '#334155' }}>
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
                  style={{ color: '#0369a1', marginRight: 6, textDecoration: 'underline' }}
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
            onClick={() => openFeatureDetails(selectedFeature.payload)}
          >
            View details
          </button>
        )}
      </div>
    );
  };

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
      <CanvasLiveDealLayer
        features={canvasFeatures}
        mapZoom={mapZoom}
        selectedUid={selectedFeature?.uid ?? null}
        onFeatureClick={setSelectedFeature}
      />
      {selectedFeature && selectedPopupPosition && (
        <Popup
          key={selectedFeature.uid}
          className="oil-live-leaflet-popup"
          position={selectedPopupPosition}
          eventHandlers={{
            remove: () => setSelectedFeature(null),
          }}
        >
          {renderSelectedPopup()}
        </Popup>
      )}
    </LayerGroup>
  );
}

export default memo(OilLiveMapOverlays);
