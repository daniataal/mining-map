"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, X } from "lucide-react";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { FEATURE } from "@/lib/entitlements";
import { fetchMCRCorridors, fetchSTSEvents, fetchVesselTrack } from "@/lib/energyApi";
import {
  API_BASE,
  defaultLayerState,
  layersForVertical,
  MAP_COLORS,
  MAP_STYLE_URL,
  mapSourceKey,
  metalsMapLayersActive,
  PERSIAN_GULF_COVERAGE_POLYGON,
  viewportOverlapsPersianGulf,
  type LayerDef,
} from "@/lib/layers";
import {
  ensureVesselImages,
  isVesselLayerId,
  vesselHasRotationFilter,
  vesselIconRotate,
  vesselNoRotationFilter,
} from "@/lib/vesselMapIcon";
import {
  vesselChevronIconSize,
  vesselDotRadius,
  vesselHullIconSize,
} from "@/lib/vesselScale";
import { ensureMapRtlPlugin } from "@/lib/mapRtl";
import { VesselDeadReckoning, parseWsFrame } from "@/lib/vesselDeadReckoning";
import type { MapSelection } from "./EntityDossierPanel";
import { stsHoverLabel } from "@/lib/stsDisplay";

type Props = {
  vertical: "energy" | "metals";
  selection?: MapSelection | null;
  onSelect: (feature: MapSelection | null) => void;
  mapFocus?: { lat: number; lng: number } | null;
  relationshipLines?: FeatureCollection;
  onRuntimeStatus?: (status: MapRuntimeStatus) => void;
  entitlements?: Partial<Record<string, boolean>>;
};

type FeatureTarget = {
  source: string;
  sourceLayer?: string;
  id: string | number;
};

const SELECTED_STROKE: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  "#5dffc8",
  "#0a0e14",
];
const SELECTED_STROKE_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  4,
  1,
];
const SELECTED_STROKE_OPACITY: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  0.95,
  0.35,
];
const VESSEL_ICON_HALO_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  2.5,
  0,
];
const SELECTED_LINE_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  6,
  3,
];
/**
 * Zoom-scaled pipeline width: hairline at region scale, substantial at port scale.
 * NOTE: ["zoom"] is only legal in a top-level interpolate/step, so the selected-state
 * case lives inside each stop output, not the other way around.
 */
const selectedOr = (selected: number, base: number): ExpressionSpecification => [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  selected,
  base,
];
const PIPELINE_LINE_WIDTH: ExpressionSpecification = [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  4,
  selectedOr(3, 0.7),
  7,
  selectedOr(4, 1.4),
  10,
  selectedOr(5, 2.4),
  14,
  selectedOr(6.5, 4),
];

export type MapRuntimeStatus = {
  wsState: "connecting" | "connected" | "disconnected" | "unavailable";
  activeLayerCount: number;
  lastWsAt?: string;
  gulfAisLimited?: boolean;
};

/** MVT point colors — keep in sync with addPointTileLayer / vessel layers */
const MAP_LEGEND_ITEMS = [
  { label: "Tank farm", color: MAP_COLORS.tankFarm },
  { label: "Terminal", color: MAP_COLORS.terminal },
  { label: "Refinery", color: MAP_COLORS.refinery },
  { label: "STS", color: MAP_COLORS.stsEvent },
  { label: "Vessel", color: MAP_COLORS.vessel },
] as const;

/** Basemap layer tweaks applied after the remote style loads (deep navy ocean). */
function tuneBasemap(map: maplibregl.Map) {
  try {
    const style = map.getStyle();
    for (const layer of style.layers ?? []) {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#060a12");
      } else if (layer.type === "fill" && /water|ocean/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", "#0b1322");
      }
    }
  } catch {
    /* defensive: remote style structure may change */
  }
}

function entityTypeForLayer(layerId: string): string {
  if (layerId === "sts-events") return "sts";
  if (isVesselLayerId(layerId)) return "vessel";
  return "asset";
}

function strProp(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function stsSelectionFromProps(props: Record<string, unknown>, layerId: string): MapSelection {
  return {
    signal_id: strProp(props.signal_id),
    id: strProp(props.signal_id),
    name: strProp(props.name) ?? strProp(props.event_title),
    event_title: strProp(props.event_title) ?? strProp(props.name),
    event_kind: strProp(props.event_kind),
    mmsi_a: strProp(props.mmsi_a),
    mmsi_b: strProp(props.mmsi_b),
    vessel_a_name: strProp(props.vessel_a_name),
    vessel_b_name: strProp(props.vessel_b_name),
    vessel_a_class: strProp(props.vessel_a_class),
    vessel_b_class: strProp(props.vessel_b_class),
    product_hint: strProp(props.product_hint),
    zone_name: strProp(props.zone_name),
    min_distance_m: props.min_distance_m as number | string | undefined,
    start_ts: strProp(props.start_ts),
    end_ts: strProp(props.end_ts),
    observed_at: strProp(props.observed_at),
    disclaimer: strProp(props.disclaimer),
    tier: strProp(props.tier),
    confidence_score: props.confidence_score as number | string | undefined,
    asset_type: strProp(props.asset_type),
    country_code: strProp(props.country_code),
    _layer: layerId,
    _entityType: "sts",
  };
}

const VESSEL_TILE_LAYERS = ["vessels-dot-low", "vessels-no-heading", "vessels-ship", "vessels-hull"] as const;
const VESSEL_LIVE_LAYERS = [
  "live-vessels-dot-low",
  "live-vessels-no-heading",
  "live-vessels-ship",
  "live-vessels-hull",
] as const;

/** Below this zoom every vessel renders as a small shady dot (like other layers). */
const VESSEL_SHAPE_MIN_ZOOM = 6.5;
/** From this zoom the LOA-scaled ship silhouette replaces the arrow. */
const VESSEL_TRUE_SCALE_ZOOM = 14;

const VESSEL_LOW_DOT_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  2,
  1.3,
  VESSEL_SHAPE_MIN_ZOOM,
  2.6,
];
const VESSEL_LOW_DOT_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  2,
  0.35,
  VESSEL_SHAPE_MIN_ZOOM,
  0.65,
];
/**
 * Tile vessels carry ais_age_h (hours since last AIS fix; tiles only serve <72h).
 * Fresh (<2h) renders solid; older last-known positions dim progressively.
 * Live WS overlay vessels have no ais_age_h and render at full opacity.
 */
const VESSEL_AGE_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["to-number", ["get", "ais_age_h"]], 0],
  2,
  1,
  24,
  0.75,
  72,
  0.45,
];

type VesselLayerSet = {
  prefix: "vessels" | "live-vessels";
  source: string;
  sourceLayer?: string;
  shipIcon: string;
  hullIcon: string;
};

function addVesselLayerSet(map: maplibregl.Map, opts: VesselLayerSet, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  const common = opts.sourceLayer
    ? { source: opts.source, "source-layer": opts.sourceLayer }
    : { source: opts.source };
  map.addLayer({
    id: `${opts.prefix}-dot-low`,
    type: "circle",
    ...common,
    maxzoom: VESSEL_SHAPE_MIN_ZOOM,
    paint: {
      "circle-radius": VESSEL_LOW_DOT_RADIUS,
      "circle-color": MAP_COLORS.vessel,
      "circle-opacity": VESSEL_LOW_DOT_OPACITY,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: `${opts.prefix}-no-heading`,
    type: "circle",
    ...common,
    minzoom: VESSEL_SHAPE_MIN_ZOOM,
    filter: vesselNoRotationFilter,
    paint: {
      "circle-radius": vesselDotRadius,
      "circle-color": MAP_COLORS.vessel,
      "circle-opacity": VESSEL_AGE_OPACITY,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
      "circle-stroke-opacity": SELECTED_STROKE_OPACITY,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: `${opts.prefix}-ship`,
    type: "symbol",
    ...common,
    minzoom: VESSEL_SHAPE_MIN_ZOOM,
    maxzoom: VESSEL_TRUE_SCALE_ZOOM,
    filter: vesselHasRotationFilter,
    layout: {
      visibility,
      "icon-image": opts.shipIcon,
      "icon-size": vesselChevronIconSize,
      "icon-rotate": vesselIconRotate,
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": VESSEL_AGE_OPACITY,
      "icon-halo-width": VESSEL_ICON_HALO_WIDTH,
      "icon-halo-color": "#5dffc8",
    },
  });
  map.addLayer({
    id: `${opts.prefix}-hull`,
    type: "symbol",
    ...common,
    minzoom: VESSEL_TRUE_SCALE_ZOOM,
    filter: vesselHasRotationFilter,
    layout: {
      visibility,
      "icon-image": opts.hullIcon,
      "icon-size": vesselHullIconSize,
      "icon-rotate": vesselIconRotate,
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-opacity": VESSEL_AGE_OPACITY,
      "icon-halo-width": VESSEL_ICON_HALO_WIDTH,
      "icon-halo-color": "#5dffc8",
    },
  });
}

function addVesselTileLayers(map: maplibregl.Map, src: string, sourceLayer: string, visible: boolean) {
  addVesselLayerSet(
    map,
    { prefix: "vessels", source: src, sourceLayer, shipIcon: "vessel-ship", hullIcon: "vessel-hull" },
    visible,
  );
}

function addLiveVesselLayers(map: maplibregl.Map, visible: boolean) {
  addVesselLayerSet(
    map,
    { prefix: "live-vessels", source: "live-vessels", shipIcon: "vessel-ship-live", hullIcon: "vessel-hull-live" },
    visible,
  );
}

/**
 * MVT tiles are the stored-intelligence base (all vessels, regardless of AIS freshness).
 * The live overlay adds fresh WS positions on top; tile copies of live vessels are
 * filtered out by MMSI (setVesselTileExclusion) so nothing draws twice (no bloom).
 */
function setVesselLayerVisibility(map: maplibregl.Map, visible: boolean, liveConnected: boolean) {
  const tileVis = visible ? "visible" : "none";
  const liveVis = visible && liveConnected ? "visible" : "none";
  for (const lid of VESSEL_TILE_LAYERS) {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", tileVis);
  }
  for (const lid of VESSEL_LIVE_LAYERS) {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", liveVis);
  }
}

const VESSEL_TILE_BASE_FILTERS: Record<(typeof VESSEL_TILE_LAYERS)[number], ExpressionSpecification | null> = {
  "vessels-dot-low": null, // zoom bounds only — no property filter
  "vessels-no-heading": vesselNoRotationFilter,
  "vessels-ship": vesselHasRotationFilter,
  "vessels-hull": vesselHasRotationFilter,
};

/** Hide tile copies of vessels already rendered by the live overlay (dedupe by MMSI). */
function setVesselTileExclusion(map: maplibregl.Map, liveMmsis: string[]) {
  const exclusion: ExpressionSpecification | null = liveMmsis.length
    ? ["!", ["in", ["get", "mmsi"], ["literal", liveMmsis]]]
    : null;
  for (const lid of VESSEL_TILE_LAYERS) {
    if (!map.getLayer(lid)) continue;
    const base = VESSEL_TILE_BASE_FILTERS[lid];
    const combined = exclusion
      ? base
        ? (["all", base, exclusion] as ExpressionSpecification)
        : exclusion
      : base;
    map.setFilter(lid, combined ?? null);
  }
}

function mvtSourceLayer(tileLayer: string): string {
  switch (tileLayer) {
    case "vessels":
      return "vessels";
    case "metals-assets":
      return "metals_assets";
    case "energy-cadastre":
      return "energy_cadastre";
    case "pipelines":
      return "petroleum_osm";
    default:
      return "energy_assets";
  }
}

/** MVT feature property used for promoteId / feature-state (not the source-layer name). */
function mvtPromoteId(tileLayer: string): string {
  return tileLayer === "vessels" ? "mmsi" : "id";
}

function energyAssetFilter(layer: LayerDef): maplibregl.FilterSpecification | undefined {
  if (!layer.assetTypes?.length) return undefined;
  if (layer.assetTypes.length === 1) {
    return ["==", ["get", "asset_type"], layer.assetTypes[0]];
  }
  return ["in", ["get", "asset_type"], ["literal", layer.assetTypes]];
}

function metalsAssetFilter(layerId: string): maplibregl.FilterSpecification | undefined {
  if (layerId === "metals-mines") {
    return ["==", ["get", "asset_type"], "mine"];
  }
  if (layerId === "metals-smelters") {
    return ["in", ["get", "asset_type"], ["literal", ["smelter", "processing_plant"]]];
  }
  return undefined;
}

/** Circles fade in 5→6 while the density heatmap fades out — no dot soup at world zoom. */
const POINT_FADE_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4.5,
  0,
  6,
  0.9,
];

function addPointTileLayer(map: maplibregl.Map, layer: LayerDef, src: string, visible: boolean) {
  const filter = energyAssetFilter(layer) ?? metalsAssetFilter(layer.id);
  const color = layer.color ?? "#10b981";
  const visibility = visible ? "visible" : "none";
  // Tight, faint halo — heavy blur at low zoom reads as mud next to crisp pipeline lines.
  map.addLayer({
    id: `${layer.id}-glow`,
    type: "circle",
    source: src,
    "source-layer": mvtSourceLayer(layer.tileLayer!),
    minzoom: 6,
    ...(filter ? { filter } : {}),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4, 10, 9],
      "circle-color": color,
      "circle-blur": 0.9,
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 7.5, 0.12],
    },
    layout: { visibility },
  });
  map.addLayer({
    id: layer.id,
    type: "circle",
    source: src,
    "source-layer": mvtSourceLayer(layer.tileLayer!),
    minzoom: 4.5,
    ...(filter ? { filter } : {}),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.5, 10, 7],
      "circle-color": color,
      "circle-opacity": POINT_FADE_OPACITY,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
      "circle-stroke-opacity": SELECTED_STROKE_OPACITY,
    },
    layout: { visibility },
  });
}

/** One density heatmap per MVT source: glowing aggregate at world zoom, fades into dots. */
function addDensityHeatLayer(
  map: maplibregl.Map,
  id: string,
  src: string,
  sourceLayer: string,
  rampColor: [string, string, string],
) {
  map.addLayer({
    id,
    type: "heatmap",
    source: src,
    "source-layer": sourceLayer,
    maxzoom: 7,
    paint: {
      "heatmap-weight": 0.6,
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 7, 1.5],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 3, 4, 12, 7, 22],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0,0,0,0)",
        0.15,
        rampColor[0],
        0.5,
        rampColor[1],
        1,
        rampColor[2],
      ],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 4.5, 0.9, 6.5, 0],
    },
  });
}

/** Filter the density heatmap to the asset types whose toggles are active. */
function heatFilterForActiveLayers(
  vertical: "energy" | "metals",
  layers: Record<string, boolean>,
): maplibregl.FilterSpecification {
  const types = layersForVertical(vertical)
    .filter((l) => l.assetTypes?.length && layers[l.id])
    .flatMap((l) => l.assetTypes!);
  return ["in", ["get", "asset_type"], ["literal", types.length ? types : ["__none__"]]];
}

const PIPELINE_LAYER_IDS = ["pipelines-hit", "pipelines", "pipelines-water"] as const;

function isPipelineLayer(layerId: string): boolean {
  return PIPELINE_LAYER_IDS.includes(layerId as (typeof PIPELINE_LAYER_IDS)[number]);
}

function addPipelineLayers(map: maplibregl.Map, src: string, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  map.addLayer({
    id: "pipelines",
    type: "line",
    source: src,
    "source-layer": "petroleum_osm",
    filter: ["!=", ["get", "pipeline_substance"], "water"],
    paint: {
      "line-color": [
        "match",
        ["get", "pipeline_substance"],
        "oil",
        "#fbbf24",
        "gas",
        "#38bdf8",
        "#fbbf24",
      ],
      "line-width": PIPELINE_LINE_WIDTH,
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.65, 8, 0.9],
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "pipelines-water",
    type: "line",
    source: src,
    "source-layer": "petroleum_osm",
    filter: ["==", ["get", "pipeline_substance"], "water"],
    paint: {
      "line-color": "#0891b2",
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 4, 0.6, 10, 2],
      "line-opacity": 0.75,
      "line-dasharray": [2, 6],
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  // Invisible fat hit-target for clicks; gated to z>=6 so it doesn't tessellate
  // the whole network at region scale (clicking a 0.7px line at z4 isn't a real flow).
  map.addLayer({
    id: "pipelines-hit",
    type: "line",
    source: src,
    "source-layer": "petroleum_osm",
    minzoom: 6,
    paint: {
      "line-color": "#000000",
      "line-width": 10,
      "line-opacity": 0,
    },
    layout: { visibility },
  });
}

function layerLocked(layer: LayerDef, entitlements?: Partial<Record<string, boolean>>): boolean {
  return !!layer.premium && !entitlements?.[FEATURE.mapPremiumLayers];
}

function interactiveLayerIds(vertical: "energy" | "metals"): string[] {
  const ids = layersForVertical(vertical)
    .filter((l) => l.tileLayer && l.id !== "vessels")
    .map((l) => l.id);
  if (vertical === "energy") {
    ids.push(...VESSEL_TILE_LAYERS, ...VESSEL_LIVE_LAYERS, ...PIPELINE_LAYER_IDS, "sts-events", "mcr-corridors");
  }
  return ids;
}

function bboxString(map: maplibregl.Map): string {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
}

function hoverLabel(props: Record<string, unknown>): string {
  const sts = stsHoverLabel(props);
  if (sts) return sts;
  const name = props.name != null ? String(props.name).trim() : "";
  const assetType = props.asset_type != null ? String(props.asset_type) : "";
  if (assetType === "sts_zone") {
    return name ? `STS anchorage · ${name}` : "STS anchorage zone";
  }
  const substance = props.pipeline_substance ?? props.substance;
  const parts = [name || assetType || "Feature"];
  if (assetType && name) parts.push(assetType.replace(/_/g, " "));
  if (substance) parts.push(String(substance));
  return parts.join(" · ");
}

function selectionFeatureTarget(sel: MapSelection, vertical: "energy" | "metals"): FeatureTarget | null {
  const layerKey = sel._layer ?? "";
  if (layerKey === "live-vessels" && sel.mmsi) {
    return { source: "live-vessels", id: sel.mmsi };
  }
  if (isVesselLayerId(layerKey) || layerKey === "vessels") {
    const id = sel.id ?? sel.mmsi;
    if (!id) return null;
    return { source: "src-vessels", sourceLayer: "vessels", id };
  }
  if (layerKey === "pipelines") {
    const id = sel.id || sel.legacy_row_id;
    if (!id) return null;
    return { source: "src-pipelines", sourceLayer: "petroleum_osm", id };
  }
  const layerDef = layersForVertical(vertical).find((l) => l.id === layerKey);
  if (!layerDef?.tileLayer || !sel.id) return null;
  return {
    source: mapSourceKey(layerDef),
    sourceLayer: mvtSourceLayer(layerDef.tileLayer),
    id: sel.id,
  };
}

function clearFeatureState(map: maplibregl.Map, target: FeatureTarget | null) {
  if (!target) return;
  try {
    map.removeFeatureState(target);
  } catch {
    /* feature may have left the viewport */
  }
}

export default function IntelligenceMap({
  vertical,
  selection,
  onSelect,
  mapFocus,
  relationshipLines,
  onRuntimeStatus,
  entitlements,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const selectedFeatureRef = useRef<FeatureTarget | null>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => defaultLayerState(vertical));
  const [wsState, setWsState] = useState<MapRuntimeStatus["wsState"]>(() =>
    vertical === "energy" ? "connecting" : "unavailable"
  );
  const [lastWsAt, setLastWsAt] = useState<string | undefined>();
  const [gulfAisLimited, setGulfAisLimited] = useState(false);
  const [layerDrawerOpen, setLayerDrawerOpen] = useState(true);
  const [layerCounts, setLayerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setLayers(defaultLayerState(vertical));
    setWsState(vertical === "energy" ? "connecting" : "unavailable");
    setLastWsAt(undefined);
    setGulfAisLimited(false);
  }, [vertical]);

  const activeLayerCount = Object.values(layers).filter(Boolean).length;

  useEffect(() => {
    onRuntimeStatus?.({
      wsState: vertical === "energy" ? wsState : "unavailable",
      activeLayerCount,
      lastWsAt,
      gulfAisLimited: vertical === "energy" && gulfAisLimited,
    });
  }, [wsState, activeLayerCount, lastWsAt, gulfAisLimited, vertical, onRuntimeStatus]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    ensureMapRtlPlugin();
    const map = new maplibregl.Map({
      container: container.current,
      transformRequest: (url, resourceType) => {
        // Only send auth cookies to our own tile API — never to the public basemap host.
        if (resourceType === "Tile" && url.startsWith(API_BASE)) {
          return { url, credentials: "include" };
        }
        return { url };
      },
      style: MAP_STYLE_URL,
      center: [55, 25],
      zoom: 4,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    let ws: WebSocket | null = null;
    let wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let moveEndHandler: (() => void) | null = null;
    let vesselMotion: VesselDeadReckoning | null = null;
    let cancelled = false;
    let animFrame = 0;

    const setupMap = () => {
      if (cancelled) return;
      ensureVesselImages(map);
      tuneBasemap(map);

      const sourcesAdded = new Set<string>();
      layersForVertical(vertical)
        .filter((l) => l.tileLayer && (vertical === "energy" || l.vertical !== "energy"))
        .forEach((layer) => {
          const src = mapSourceKey(layer);
          if (!sourcesAdded.has(src)) {
            map.addSource(src, {
              type: "vector",
              tiles: [`${API_BASE}/tiles/${layer.tileLayer}/{z}/{x}/{y}.mvt`],
              minzoom: layer.tileLayer === "pipelines" ? 4 : 0,
              maxzoom: 14,
              promoteId: mvtPromoteId(layer.tileLayer!),
            });
            sourcesAdded.add(src);
            if (layer.tileLayer === "energy-assets") {
              addDensityHeatLayer(map, "energy-assets-heat", src, "energy_assets", [
                "rgba(120,53,15,0.4)",
                "rgba(217,119,6,0.6)",
                "rgba(254,243,199,0.9)",
              ]);
              map.setFilter("energy-assets-heat", heatFilterForActiveLayers("energy", layers));
            } else if (layer.tileLayer === "metals-assets") {
              addDensityHeatLayer(map, "metals-assets-heat", src, "metals_assets", [
                "rgba(113,63,18,0.4)",
                "rgba(202,138,4,0.6)",
                "rgba(254,249,195,0.9)",
              ]);
              map.setFilter("metals-assets-heat", heatFilterForActiveLayers("metals", layers));
            }
          }
          if (layer.id === "pipelines") {
            if (vertical === "energy") {
              addPipelineLayers(map, src, !!layers[layer.id]);
            }
            return;
          }
          if (layer.id === "vessels") {
            addVesselTileLayers(map, src, mvtSourceLayer(layer.tileLayer!), !!layers[layer.id]);
            return;
          }
          addPointTileLayer(map, layer, src, !!layers[layer.id]);
        });

      const updateLayerCounts = () => {
        const counts: Record<string, number> = {};
        for (const l of layersForVertical(vertical)) {
          if (!l.tileLayer) continue;
          try {
            if (l.id === "vessels") {
              const vesselLayers = [...VESSEL_TILE_LAYERS, ...VESSEL_LIVE_LAYERS].filter(
                (lid) => map.getLayer(lid) && map.getLayoutProperty(lid, "visibility") !== "none",
              );
              if (vesselLayers.length) {
                counts[l.id] = map.queryRenderedFeatures({ layers: [...vesselLayers] }).length;
              }
              continue;
            }
            if (!map.getLayer(l.id)) continue;
            if (map.getLayoutProperty(l.id, "visibility") === "none") continue;
            counts[l.id] = map.queryRenderedFeatures({ layers: [l.id] }).length;
          } catch {
            /* layer may not be queryable yet */
          }
        }
        setLayerCounts(counts);
      };
      map.on("idle", updateLayerCounts);

      map.on("click", (e) => {
        const feats = map.queryRenderedFeatures(e.point);
        const activeIds = new Set(layersForVertical(vertical).map((l) => l.id));
        const hit = feats.find(
          (f) =>
            activeIds.has(f.layer.id) ||
            f.layer.id === "sts-events" ||
            isPipelineLayer(f.layer.id) ||
            (vertical === "energy" && isVesselLayerId(f.layer.id))
        );
        if (!hit) {
          onSelect(null);
          return;
        }
        const props = hit.properties as MapSelection;
        const layerId = isPipelineLayer(hit.layer.id)
          ? "pipelines"
          : isVesselLayerId(hit.layer.id)
            ? hit.layer.id.startsWith("live-vessels")
              ? "live-vessels"
              : "vessels"
            : hit.layer.id;
        if (layerId === "sts-events") {
          onSelect(stsSelectionFromProps(props as Record<string, unknown>, layerId));
          return;
        }
        onSelect({
          ...props,
          id: props.id != null ? String(props.id) : undefined,
          legacy_row_id: (props as { legacy_row_id?: string }).legacy_row_id != null
            ? String((props as { legacy_row_id?: string }).legacy_row_id)
            : undefined,
          mmsi: props.mmsi != null ? String(props.mmsi) : undefined,
          name: props.name != null ? String(props.name) : undefined,
          asset_type: props.asset_type != null ? String(props.asset_type) : undefined,
          operator: props.operator != null ? String(props.operator) : undefined,
          substance: props.substance != null ? String(props.substance) : undefined,
          pipeline_substance: props.pipeline_substance != null ? String(props.pipeline_substance) : undefined,
          _layer: layerId,
          _entityType: entityTypeForLayer(layerId),
        });
      });

      const hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "map-hover-popup",
        offset: 12,
      });
      hoverPopupRef.current = hoverPopup;
      const hoverLayers = interactiveLayerIds(vertical);
      map.on("mousemove", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: hoverLayers })[0];
        if (!hit) {
          map.getCanvas().style.cursor = "";
          hoverPopup.remove();
          return;
        }
        map.getCanvas().style.cursor = "pointer";
        const props = (hit.properties ?? {}) as Record<string, unknown>;
        hoverPopup
          .setLngLat(e.lngLat)
          .setHTML(`<div class="map-hover-title" dir="auto">${hoverLabel(props)}</div>`)
          .addTo(map);
      });
      map.on("mouseleave", () => {
        map.getCanvas().style.cursor = "";
        hoverPopup.remove();
      });

      const liveFC: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
      map.addSource("live-vessels", { type: "geojson", data: liveFC, promoteId: "mmsi" });
      const relData = relationshipLines ?? { type: "FeatureCollection" as const, features: [] };
      map.addSource("rel-lines", { type: "geojson", data: relData });
      map.addLayer({
        id: "rel-lines",
        type: "line",
        source: "rel-lines",
        paint: {
          "line-color": "#5eb3ff",
          "line-width": 2,
          "line-opacity": 0.65,
          "line-dasharray": [2, 2],
        },
      });

      if (vertical === "energy") {
        map.addSource("sts-events", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "signal_id",
        });
        map.addSource("mcr-corridors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          lineMetrics: true,
        });
        map.addSource("ais-coverage", {
          type: "geojson",
          data: { type: "Feature", geometry: PERSIAN_GULF_COVERAGE_POLYGON, properties: {} },
        });
        map.addSource("vessel-track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

        map.addLayer({
          id: "ais-coverage-fill",
          type: "fill",
          source: "ais-coverage",
          paint: { "fill-color": "#f59e0b", "fill-opacity": 0.05 },
          layout: { visibility: layers["ais-coverage"] ? "visible" : "none" },
        });
        map.addLayer({
          id: "mcr-corridors",
          type: "line",
          source: "mcr-corridors",
          paint: {
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.5, 8, 3],
            "line-opacity": 0.8,
            // load → discharge direction encoded as amber → cyan
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              MAP_COLORS.corridorLoad,
              1,
              MAP_COLORS.corridorDischarge,
            ],
          },
          layout: { visibility: layers["mcr-corridors"] ? "visible" : "none", "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "sts-events-glow",
          type: "circle",
          source: "sts-events",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 18],
            "circle-color": MAP_COLORS.stsEvent,
            "circle-blur": 1.3,
            "circle-opacity": 0.3,
          },
          layout: { visibility: layers["sts-events"] ? "visible" : "none" },
        });
        map.addLayer({
          id: "sts-events",
          type: "circle",
          source: "sts-events",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 8, 14, 12],
            "circle-color": MAP_COLORS.stsEvent,
            "circle-opacity": 0.85,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-opacity": 0.6,
          },
          layout: { visibility: layers["sts-events"] ? "visible" : "none" },
        });
        map.addLayer({
          id: "vessel-track",
          type: "line",
          source: "vessel-track",
          paint: {
            "line-color": MAP_COLORS.vessel,
            "line-width": 3,
            "line-opacity": 0.9,
            "line-dasharray": [0, 4, 3],
          },
        });

        const refreshOverlays = () => {
          const bbox = bboxString(map);
          if (layers["sts-events"]) {
            fetchSTSEvents(bbox)
              .then((fc) => {
                const src = map.getSource("sts-events") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
          if (layers["mcr-corridors"]) {
            fetchMCRCorridors(bbox)
              .then((fc) => {
                const src = map.getSource("mcr-corridors") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
        };
        map.on("moveend", refreshOverlays);
        refreshOverlays();
      }

      if (vertical === "energy") {
        addLiveVesselLayers(map, !!layers.vessels);
        // Default to MVT until WS connects — prevents double-render bloom on first paint.
        setVesselLayerVisibility(map, !!layers.vessels, false);

        // Marching dash on the focused vessel track only.
        const dashPhases: number[][] = [
          [0, 4, 3],
          [0.5, 4, 2.5],
          [1, 4, 2],
          [1.5, 4, 1.5],
          [2, 4, 1],
          [2.5, 4, 0.5],
          [3, 4, 0],
        ];
        let lastTick = 0;
        const animate = (now: number) => {
          if (cancelled) return;
          if (now - lastTick > 90) {
            lastTick = now;
            if (map.getLayer("vessel-track")) {
              const phase = dashPhases[Math.floor((now / 90) % dashPhases.length)];
              map.setPaintProperty("vessel-track", "line-dasharray", phase);
            }
          }
          animFrame = requestAnimationFrame(animate);
        };
        animFrame = requestAnimationFrame(animate);

        const updateGulfCoverage = () => {
          const b = map.getBounds();
          setGulfAisLimited(viewportOverlapsPersianGulf({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          }));
        };
        map.on("moveend", updateGulfCoverage);
        updateGulfCoverage();

        const liveSrc = () => map.getSource("live-vessels") as maplibregl.GeoJSONSource | undefined;
        let liveMmsiKey = "";
        vesselMotion = new VesselDeadReckoning({
          getBbox: () => {
            const b = map.getBounds();
            return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
          },
          onFeatures: (features) => {
            const src = liveSrc();
            if (src) src.setData({ type: "FeatureCollection", features });
            // Dedupe tiles vs live overlay only when membership changes (not per animation frame).
            const mmsis = features
              .map((f) => String(f.properties?.mmsi ?? ""))
              .filter(Boolean)
              .sort();
            const key = mmsis.join(",");
            if (key !== liveMmsiKey) {
              liveMmsiKey = key;
              setVesselTileExclusion(map, mmsis);
            }
          },
        });

        const wsUrl = `${API_BASE.replace("http", "ws")}/api/core/ws?format=msgpack`;
        // Auto-reconnect with capped backoff so an API restart doesn't silently
        // kill the live overlay for already-open tabs.
        let wsRetryMs = 2000;
        const connectWs = () => {
          if (cancelled) return;
          try {
            ws = new WebSocket(wsUrl);
          } catch {
            setWsState("unavailable");
            return;
          }
          ws.binaryType = "arraybuffer";
          ws.onmessage = (ev) => {
            setLastWsAt(new Date().toISOString());
            const payload = ev.data instanceof ArrayBuffer ? ev.data : (ev.data as string);
            const msg = parseWsFrame(payload);
            if (!msg) return;
            if (msg.type === "snapshot" && Array.isArray(msg.vessels)) {
              vesselMotion?.replaceAll(msg.vessels);
            } else if (msg.type === "delta" && msg.entity === "vessel" && msg.data?.mmsi) {
              vesselMotion?.upsert(msg.data);
            }
          };
          ws.onopen = () => {
            wsRetryMs = 2000;
            setWsState("connected");
            setVesselLayerVisibility(map, !!layers.vessels, true);
            const sendSub = () => {
              if (ws?.readyState !== WebSocket.OPEN) return;
              const b = map.getBounds();
              ws.send(JSON.stringify({
                bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
                zoom: map.getZoom(),
                layers: Object.keys(layers).filter((k) => layers[k]),
              }));
              vesselMotion?.viewportChanged();
            };
            if (moveEndHandler) map.off("moveend", moveEndHandler);
            moveEndHandler = sendSub;
            map.on("moveend", sendSub);
            sendSub();
          };
          ws.onclose = () => {
            setWsState("disconnected");
            setVesselLayerVisibility(map, !!layers.vessels, false);
            vesselMotion?.clear(); // empties live source + restores full tile filter
            if (!cancelled) {
              wsRetryTimer = setTimeout(connectWs, wsRetryMs);
              wsRetryMs = Math.min(wsRetryMs * 2, 30000);
            }
          };
          ws.onerror = () => {
            ws?.close(); // funnel retries through onclose
          };
        };
        connectWs();
      }
    };

    if (map.loaded()) {
      setupMap();
    } else {
      map.once("load", setupMap);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(animFrame);
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      if (moveEndHandler) map.off("moveend", moveEndHandler);
      vesselMotion?.dispose();
      vesselMotion = null;
      hoverPopupRef.current?.remove();
      hoverPopupRef.current = null;
      ws?.close();
      map.remove();
      mapRef.current = null;
    };
  }, [vertical, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    clearFeatureState(map, selectedFeatureRef.current);
    selectedFeatureRef.current = null;
    if (!selection) return;
    const target = selectionFeatureTarget(selection, vertical);
    if (!target) return;
    try {
      map.setFeatureState(target, { selected: true });
      selectedFeatureRef.current = target;
    } catch {
      /* tile may not be loaded yet */
    }
  }, [selection, vertical]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapFocus) return;
    map.flyTo({ center: [mapFocus.lng, mapFocus.lat], zoom: Math.max(map.getZoom(), 8), duration: 1200 });
  }, [mapFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("rel-lines") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(relationshipLines ?? { type: "FeatureCollection", features: [] });
    }
  }, [relationshipLines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersForVertical(vertical).forEach((l) => {
      if (l.id === "pipelines") {
        const vis = layers[l.id] && !layerLocked(l, entitlements) ? "visible" : "none";
        for (const pid of PIPELINE_LAYER_IDS) {
          if (map.getLayer(pid)) map.setLayoutProperty(pid, "visibility", vis);
        }
        return;
      }
      const vis = layers[l.id] ? "visible" : "none";
      if (map.getLayer(l.id)) {
        map.setLayoutProperty(l.id, "visibility", vis);
      }
      if (map.getLayer(`${l.id}-glow`)) {
        map.setLayoutProperty(`${l.id}-glow`, "visibility", vis);
      }
    });
    if (map.getLayer("energy-assets-heat")) {
      map.setFilter("energy-assets-heat", heatFilterForActiveLayers("energy", layers));
    }
    if (map.getLayer("metals-assets-heat")) {
      map.setFilter("metals-assets-heat", heatFilterForActiveLayers("metals", layers));
    }
    if (vertical === "energy") {
      setVesselLayerVisibility(map, !!layers.vessels, wsState === "connected");
      for (const lid of ["sts-events", "sts-events-glow", "mcr-corridors", "ais-coverage-fill"] as const) {
        if (map.getLayer(lid)) {
          const key = lid === "ais-coverage-fill" ? "ais-coverage" : lid === "sts-events-glow" ? "sts-events" : lid;
          map.setLayoutProperty(lid, "visibility", layers[key] ? "visible" : "none");
        }
      }
      if (layers["sts-events"] || layers["mcr-corridors"]) {
        const bbox = bboxString(map);
        if (layers["sts-events"]) {
          fetchSTSEvents(bbox)
            .then((fc) => (map.getSource("sts-events") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
        if (layers["mcr-corridors"]) {
          fetchMCRCorridors(bbox)
            .then((fc) => (map.getSource("mcr-corridors") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
      }
    }
  }, [layers, vertical, wsState, entitlements]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || vertical !== "energy") return;
    const mmsi = selection?.mmsi;
    const src = map.getSource("vessel-track") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!mmsi || selection?._entityType !== "vessel") {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    fetchVesselTrack(mmsi, 24)
      .then((fc) => src.setData(fc))
      .catch(() => src.setData({ type: "FeatureCollection", features: [] }));
  }, [selection, vertical]);

  const showMetalsEmpty = vertical === "metals" && !metalsMapLayersActive(layers);

  const formatCount = (n?: number) => {
    if (n == null) return null;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  };

  return (
    <div className="map-wrap">
      <button
        type="button"
        className={`layer-drawer-toggle${layerDrawerOpen ? " open" : ""}`}
        title={layerDrawerOpen ? "Hide layers" : "Show layers"}
        onClick={() => setLayerDrawerOpen((v) => !v)}
      >
        <Layers size={16} />
      </button>
      {layerDrawerOpen && (
      <div className="layer-drawer">
        <div className="layer-drawer-header">
          <span>Layers</span>
          <button type="button" className="layer-drawer-close" title="Hide layers" onClick={() => setLayerDrawerOpen(false)}>
            <X size={14} />
          </button>
        </div>
        {(() => {
          let lastGroup = "";
          return layersForVertical(vertical).map((l) => {
            if (l.geoJsonSource && !l.tileLayer && vertical === "metals") return null;
            const locked = layerLocked(l, entitlements);
            const showGroup = l.group && l.group !== lastGroup;
            if (l.group) lastGroup = l.group;
            const count = formatCount(layerCounts[l.id]);
            return (
              <div key={l.id}>
                {showGroup && <div className="layer-group-label">{l.group}</div>}
                <label className={`layer-row${locked ? " locked" : ""}`}>
                  <input
                    type="checkbox"
                    className="layer-switch"
                    checked={!!layers[l.id] && !locked}
                    disabled={locked || (!l.tileLayer && !l.geoJsonSource)}
                    onChange={(e) => setLayers((prev) => ({ ...prev, [l.id]: e.target.checked }))}
                  />
                  {l.color && <span className="layer-row-swatch" style={{ background: l.color }} />}
                  <span className="layer-row-label">
                    {l.label}
                    {locked ? " (plan)" : ""}
                  </span>
                  {count != null && layers[l.id] && <span className="layer-row-count">{count}</span>}
                </label>
                {l.drawerHint && (
                  <div className="layer-row-hint">
                    {locked
                      ? l.id === "pipelines"
                        ? "Sign in (Deals or Portal) to toggle pipelines — included on the free plan in dev."
                        : "Upgrade plan or sign in to unlock premium map layers."
                      : l.drawerHint}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
      )}
      {vertical === "energy" && (
        <div className="map-legend" aria-label="Infrastructure legend">
          {MAP_LEGEND_ITEMS.map((item) => (
            <span key={item.label} className="map-legend-item">
              <span className="map-legend-swatch" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
      {showMetalsEmpty && (
        <div className="map-empty-state" role="status">
          <strong>No metals layers visible</strong>
          <p>
            Toggle <span>Mining licenses</span> or <span>Smelters &amp; plants</span> above.
            License cadastre coverage is partial — many jurisdictions are not ingested yet.
            Petroleum OSM infrastructure stays on the energy vertical only.
          </p>
        </div>
      )}
      <div id="map" ref={container} />
    </div>
  );
}
