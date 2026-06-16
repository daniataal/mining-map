"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Layers, X } from "lucide-react";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { applyBasemapTuning } from "@/lib/basemapLabels";
import { FEATURE } from "@/lib/entitlements";
import { fetchAssetGeometries, fetchMCRCorridors, fetchSTSEvents, fetchSTSPredictions, fetchSTSSummary, fetchStorageSites, fetchVesselTrack, type STSSummary } from "@/lib/energyApi";
import { useTheme } from "@/contexts/ThemeContext";
import {
  apiBase,
  defaultLayerState,
  isLayerGroupOn,
  isOwnTileUrl,
  layerGroupsForVertical,
  layersForVertical,
  MAP_COLORS,
  mapStyleForTheme,
  mapSourceKey,
  wsApiBase,
  metalsMapLayersActive,
  type LayerDef,
  type LayerGroupDef,
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
import type { PipelineMapFocus } from "@/lib/energyApi";
type Props = {
  vertical: "energy" | "metals";
  selection?: MapSelection | null;
  onSelect: (feature: MapSelection | null) => void;
  mapFocus?: { lat: number; lng: number } | null;
  relationshipLines?: FeatureCollection;
  pipelineFocus?: PipelineMapFocus;
  onExitPipelineFocus?: () => void;
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
};

/** MVT point colors — keep in sync with addPointTileLayer / vessel layers */
const MAP_LEGEND_ITEMS = [
  { label: "Tank farm", color: MAP_COLORS.tankFarm },
  { label: "Terminal", color: MAP_COLORS.terminal },
  { label: "Refinery", color: MAP_COLORS.refinery },
  { label: "GEM route", color: MAP_COLORS.gemRoute },
  { label: "STS", color: MAP_COLORS.stsEvent },
  { label: "STS prediction", color: MAP_COLORS.stsPrediction },
  { label: "Vessel", color: MAP_COLORS.vessel },
] as const;

function entityTypeForLayer(layerId: string): string {
  if (layerId === "sts-events" || layerId === "sts-predictions") return "sts";
  if (isVesselLayerId(layerId)) return "vessel";
  return "asset";
}

function strProp(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function quickPopupEntityLabel(selection: MapSelection): string {
  if (selection._entityType === "vessel") return "vessel";
  if (selection._entityType === "sts") return "STS signal";
  const assetType = strProp(selection.asset_type);
  if (assetType) return assetType.replace(/_/g, " ");
  if (selection._layer === "pipelines") return "pipeline";
  if (selection._layer === "storage-sites") return "storage site";
  return selection._entityType ?? "asset";
}

function dossierHref(selection: MapSelection): string | null {
  if (selection._entityType === "vessel" && selection.mmsi) {
    const qs = selection.name ? `?name=${encodeURIComponent(selection.name)}` : "";
    return `/intel/vessel/${encodeURIComponent(selection.mmsi)}${qs}`;
  }
  if ((selection._entityType === "asset" || selection._entityType === "company") && selection.id) {
    const qs = new URLSearchParams();
    if (selection.name) qs.set("name", selection.name);
    if (selection.legacy_row_id) qs.set("legacy", selection.legacy_row_id);
    const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
    return `/intel/${encodeURIComponent(selection._entityType)}/${encodeURIComponent(selection.id)}${suffix}`;
  }
  return null;
}

function selectionFromMapHit(
  props: MapSelection,
  layerId: string,
  lngLat: { lat: number; lng: number },
): MapSelection {
  const rawProps = props as Record<string, unknown>;
  return {
    ...props,
    id: layerId === "gem-asset-geometries"
      ? rawProps.asset_id != null
        ? String(rawProps.asset_id)
        : undefined
      : props.id != null
        ? String(props.id)
        : undefined,
    legacy_row_id: (props as { legacy_row_id?: string }).legacy_row_id != null
      ? String((props as { legacy_row_id?: string }).legacy_row_id)
      : undefined,
    osm_id: (props as { osm_id?: string }).osm_id != null
      ? String((props as { osm_id?: string }).osm_id)
      : undefined,
    pipeline_source: (props as { pipeline_source?: string }).pipeline_source != null
      ? String((props as { pipeline_source?: string }).pipeline_source)
      : undefined,
    pipeline_status: (props as { pipeline_status?: string }).pipeline_status != null
      ? String((props as { pipeline_status?: string }).pipeline_status)
      : undefined,
    mmsi: props.mmsi != null ? String(props.mmsi) : undefined,
    name: layerId === "gem-asset-geometries" && rawProps.asset_name != null
      ? String(rawProps.asset_name)
      : props.name != null
        ? String(props.name)
        : undefined,
    asset_type: props.asset_type != null ? String(props.asset_type) : undefined,
    operator: props.operator != null ? String(props.operator) : undefined,
    substance: props.substance != null ? String(props.substance) : undefined,
    pipeline_substance: props.pipeline_substance != null ? String(props.pipeline_substance) : undefined,
    confidence_score: props.confidence_score != null ? String(props.confidence_score) : undefined,
    click_lat: lngLat.lat,
    click_lng: lngLat.lng,
    _layer: layerId,
    _entityType: entityTypeForLayer(layerId),
  };
}

function popupRow(label: string, value?: string): HTMLElement | null {
  if (!value) return null;
  const row = document.createElement("span");
  const k = document.createElement("small");
  const v = document.createElement("strong");
  k.textContent = label;
  v.textContent = value;
  row.append(k, v);
  return row;
}

function buildQuickPopupNode(selection: MapSelection, onInspect: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "map-click-card";

  const top = document.createElement("div");
  top.className = "map-click-card-top";
  const type = document.createElement("span");
  type.className = "badge compact partial";
  type.textContent = quickPopupEntityLabel(selection);
  const score = document.createElement("span");
  score.className = "map-click-score";
  score.textContent = strProp(selection.confidence_score) ? `score ${strProp(selection.confidence_score)}` : "source";
  top.append(type, score);

  const title = document.createElement("strong");
  title.className = "map-click-title";
  title.textContent = selection.name || selection.event_title || selection.mmsi || "Selected feature";

  const rows = document.createElement("div");
  rows.className = "map-click-rows";
  [
    popupRow("operator", strProp(selection.operator)),
    popupRow("product", strProp(selection.substance) || strProp(selection.pipeline_substance) || strProp(selection.product_hint)),
    popupRow("status", strProp(selection.pipeline_status) || strProp(selection.review_tier)),
    popupRow("id", strProp(selection.id) || strProp(selection.mmsi) || strProp(selection.osm_id)),
  ].forEach((row) => {
    if (row) rows.appendChild(row);
  });

  const actions = document.createElement("div");
  actions.className = "map-click-actions";
  const inspect = document.createElement("button");
  inspect.type = "button";
  inspect.textContent = "Inspect rail";
  inspect.addEventListener("click", onInspect);
  actions.appendChild(inspect);

  const href = dossierHref(selection);
  if (href) {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open dossier";
    open.addEventListener("click", () => {
      window.location.href = href;
    });
    actions.appendChild(open);
  }

  root.append(top, title);
  if (rows.childElementCount > 0) root.appendChild(rows);
  root.appendChild(actions);
  return root;
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
    transfer_probability: props.transfer_probability as number | string | undefined,
    proximity_score: props.proximity_score as number | string | undefined,
    cargo_confidence: props.cargo_confidence as number | string | undefined,
    future_pair_probability: props.future_pair_probability as number | string | undefined,
    horizon_hours: props.horizon_hours as number | string | undefined,
    prediction_kind: strProp(props.prediction_kind),
    pair_key: strProp(props.pair_key),
    context_label: strProp(props.context_label),
    review_tier: strProp(props.review_tier),
    downgrade_reasons: props.downgrade_reasons,
    maritime_context: props.maritime_context,
    nearest_oil_terminal: props.nearest_oil_terminal,
    distance_m: props.distance_m as number | string | undefined,
    latest_a: strProp(props.latest_a),
    latest_b: strProp(props.latest_b),
    event_lat: props.event_lat as number | string | undefined,
    event_lon: props.event_lon as number | string | undefined,
    closest_approach_ts: strProp(props.closest_approach_ts),
    predicted_at: strProp(props.predicted_at),
    expires_at: strProp(props.expires_at),
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
 * Live WS overlay uses the same opacity curve; only fixes <12h appear on the live layer.
 * Fresh (<2h) renders solid; older last-known positions dim progressively.
 */
const VESSEL_AGE_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["coalesce", ["to-number", ["get", "ais_age_h"]], 0],
  2,
  1,
  12,
  0.55,
  24,
  0.35,
  72,
  0.2,
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
  const setIfPresent = (lid: string, visibility: "visible" | "none") => {
    try {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", visibility);
    } catch {
      // MapLibre can briefly clear style internals during reload/unmount while async AIS callbacks settle.
    }
  };
  for (const lid of VESSEL_TILE_LAYERS) {
    setIfPresent(lid, tileVis);
  }
  for (const lid of VESSEL_LIVE_LAYERS) {
    setIfPresent(lid, liveVis);
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
const GEM_ASSET_GEOMETRY_LAYER_IDS = [
  "gem-asset-geometries-fill",
  "gem-asset-geometries-line-hit",
  "gem-asset-geometries-line-glow",
  "gem-asset-geometries-line",
  "gem-asset-geometries-point-glow",
  "gem-asset-geometries-point",
] as const;

const PIPELINE_SUBSTANCE_OIL: maplibregl.FilterSpecification = ["!=", ["get", "pipeline_substance"], "water"];
const PIPELINE_SUBSTANCE_WATER: maplibregl.FilterSpecification = ["==", ["get", "pipeline_substance"], "water"];

function pipelineFocusMatchFilter(focus: NonNullable<PipelineMapFocus>): maplibregl.FilterSpecification | null {
  const parts: maplibregl.FilterSpecification[] = [];
  if (focus.osmId) parts.push(["==", ["get", "osm_id"], focus.osmId]);
  if (focus.legacyRowId) parts.push(["==", ["get", "legacy_row_id"], focus.legacyRowId]);
  if (focus.assetId) parts.push(["==", ["get", "id"], focus.assetId]);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : (["any", ...parts] as maplibregl.FilterSpecification);
}

function restorePipelineLayerFilters(map: maplibregl.Map) {
  if (map.getLayer("pipelines")) map.setFilter("pipelines", PIPELINE_SUBSTANCE_OIL);
  if (map.getLayer("pipelines-water")) map.setFilter("pipelines-water", PIPELINE_SUBSTANCE_WATER);
  if (map.getLayer("pipelines-hit")) map.setFilter("pipelines-hit", null);
  for (const l of layersForVertical("energy")) {
    if (l.tileLayer !== "energy-assets" || !l.assetTypes?.length) continue;
    const base = energyAssetFilter(l);
    if (!base) continue;
    if (map.getLayer(l.id)) map.setFilter(l.id, base);
    if (map.getLayer(`${l.id}-glow`)) map.setFilter(`${l.id}-glow`, base);
  }
}

function applyPipelineFocusToMap(map: maplibregl.Map, focus: NonNullable<PipelineMapFocus>) {
  const match = pipelineFocusMatchFilter(focus);
  if (match) {
    for (const pid of PIPELINE_LAYER_IDS) {
      if (!map.getLayer(pid)) continue;
      if (pid === "pipelines-water") {
        map.setFilter(pid, ["all", PIPELINE_SUBSTANCE_WATER, match] as maplibregl.FilterSpecification);
      } else if (pid === "pipelines") {
        map.setFilter(pid, ["all", PIPELINE_SUBSTANCE_OIL, match] as maplibregl.FilterSpecification);
      } else {
        map.setFilter(pid, match);
      }
    }
  }

  if (focus.connectedAssetIds.length > 0) {
    const idFilter = ["in", ["get", "id"], ["literal", focus.connectedAssetIds]] as maplibregl.FilterSpecification;
    for (const l of layersForVertical("energy")) {
      if (l.tileLayer !== "energy-assets" || !l.assetTypes?.length) continue;
      const base = energyAssetFilter(l);
      if (!base) continue;
      const combined = ["all", base, idFilter] as maplibregl.FilterSpecification;
      if (map.getLayer(l.id)) map.setFilter(l.id, combined);
      if (map.getLayer(`${l.id}-glow`)) map.setFilter(`${l.id}-glow`, combined);
    }
  }

  const focusSrc = map.getSource("pipeline-focus-sites") as maplibregl.GeoJSONSource | undefined;
  if (focusSrc && focus.overlay.features.length > 0) {
    focusSrc.setData(focus.overlay);
  }
}

function featureMatchesPipelineFocus(
  props: Record<string, unknown>,
  focus: NonNullable<PipelineMapFocus>,
): boolean {
  if (focus.osmId && String(props.osm_id ?? "") === focus.osmId) return true;
  if (focus.legacyRowId && String(props.legacy_row_id ?? "") === focus.legacyRowId) return true;
  if (focus.assetId && String(props.id ?? "") === focus.assetId) return true;
  return false;
}

function countFocusedPipelinesInView(map: maplibregl.Map, focus: NonNullable<PipelineMapFocus>): number {
  const layers = PIPELINE_LAYER_IDS.filter(
    (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none",
  );
  if (!layers.length) return 0;
  return map.queryRenderedFeatures({ layers }).filter((f) =>
    featureMatchesPipelineFocus((f.properties ?? {}) as Record<string, unknown>, focus),
  ).length;
}

function isPipelineLayer(layerId: string): boolean {
  return PIPELINE_LAYER_IDS.includes(layerId as (typeof PIPELINE_LAYER_IDS)[number]);
}

function isGemAssetGeometryLayer(layerId: string): boolean {
  return GEM_ASSET_GEOMETRY_LAYER_IDS.includes(layerId as (typeof GEM_ASSET_GEOMETRY_LAYER_IDS)[number]);
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

function gemRouteColor(): ExpressionSpecification {
  return [
    "match",
    ["get", "source_key"],
    "gem_ggit_gas_pipelines_geojson",
    "#38bdf8",
    "gem_goit_oil_ngl_pipelines_geojson",
    "#fbbf24",
    "gem_ggit_lng_terminals_geojson",
    MAP_COLORS.gemRoute,
    MAP_COLORS.gemRoute,
  ];
}

function addGemAssetGeometryLayers(map: maplibregl.Map, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  const lineFilter = ["==", ["geometry-type"], "LineString"] as maplibregl.FilterSpecification;
  const polygonFilter = ["==", ["geometry-type"], "Polygon"] as maplibregl.FilterSpecification;
  const pointFilter = ["==", ["geometry-type"], "Point"] as maplibregl.FilterSpecification;
  map.addLayer({
    id: "gem-asset-geometries-fill",
    type: "fill",
    source: "gem-asset-geometries",
    filter: polygonFilter,
    paint: {
      "fill-color": gemRouteColor(),
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.08, 10, 0.16],
      "fill-outline-color": MAP_COLORS.gemRoute,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: "gem-asset-geometries-line-glow",
    type: "line",
    source: "gem-asset-geometries",
    filter: lineFilter,
    paint: {
      "line-color": gemRouteColor(),
      "line-width": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 9, 7],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.08, 9, 0.18],
      "line-blur": 2,
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "gem-asset-geometries-line",
    type: "line",
    source: "gem-asset-geometries",
    filter: lineFilter,
    paint: {
      "line-color": gemRouteColor(),
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 4, 0.8, 9, 2.2, 13, 4],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 9, 0.9],
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "gem-asset-geometries-line-hit",
    type: "line",
    source: "gem-asset-geometries",
    filter: lineFilter,
    paint: {
      "line-color": "#000000",
      "line-width": 12,
      "line-opacity": 0,
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "gem-asset-geometries-point-glow",
    type: "circle",
    source: "gem-asset-geometries",
    filter: pointFilter,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 15],
      "circle-color": MAP_COLORS.gemRoute,
      "circle-blur": 1.1,
      "circle-opacity": 0.22,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: "gem-asset-geometries-point",
    type: "circle",
    source: "gem-asset-geometries",
    filter: pointFilter,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 7],
      "circle-color": MAP_COLORS.gemRoute,
      "circle-opacity": 0.86,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
      "circle-stroke-opacity": SELECTED_STROKE_OPACITY,
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
    ids.push(
      ...VESSEL_TILE_LAYERS,
      ...VESSEL_LIVE_LAYERS,
      ...PIPELINE_LAYER_IDS,
      ...GEM_ASSET_GEOMETRY_LAYER_IDS,
      "sts-events",
      "sts-predictions",
      "mcr-corridors",
      "storage-sites",
    );
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
  if (props.source_key && props.asset_name) {
    const assetType = props.asset_type != null ? String(props.asset_type).replace(/_/g, " ") : "";
    const geometryType = props.geometry_type != null ? String(props.geometry_type) : "";
    return ["GEM", String(props.asset_name), assetType, geometryType].filter(Boolean).join(" · ");
  }
  const name = props.name != null ? String(props.name).trim() : "";
  if (props.entity_kind === "storage_site") {
    const tanks = props.tank_count != null ? `${props.tank_count} tanks` : "";
    return ["Storage site (est.)", name, tanks].filter(Boolean).join(" · ");
  }
  const assetType = props.asset_type != null ? String(props.asset_type) : "";
  if (assetType === "sts_zone") {
    return name ? `STS anchorage · ${name}` : "STS anchorage zone";
  }
  const isGem =
    props.pipeline_source === "gem" || String(props.osm_id ?? "").startsWith("gem:");
  const substance = props.pipeline_substance ?? props.substance;
  const status = props.pipeline_status != null ? String(props.pipeline_status).trim() : "";
  const parts = [name || assetType || "Feature"];
  if (assetType && name) parts.push(assetType.replace(/_/g, " "));
  if (substance) parts.push(String(substance));
  if (status) parts.push(status);
  if (isGem) parts.push("GEM GOIT");
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
  if (layerKey === "gem-asset-geometries" && sel.id) {
    return { source: "gem-asset-geometries", id: sel.id };
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
  pipelineFocus,
  onExitPipelineFocus,
  onRuntimeStatus,
  entitlements,
}: Props) {
  const { theme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);
  const clickPopupRef = useRef<maplibregl.Popup | null>(null);
  const selectedFeatureRef = useRef<FeatureTarget | null>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => defaultLayerState(vertical));
  const layersRef = useRef(layers);
  const [wsState, setWsState] = useState<MapRuntimeStatus["wsState"]>(() =>
    vertical === "energy" ? "connecting" : "unavailable"
  );
  const [lastWsAt, setLastWsAt] = useState<string | undefined>();
  const [layerDrawerOpen, setLayerDrawerOpen] = useState(true);
  const [layerCounts, setLayerCounts] = useState<Record<string, number>>({});
  const [stsSummary, setStsSummary] = useState<STSSummary | null>(null);
  const pipelineFocusRef = useRef<PipelineMapFocus>(null);

  useEffect(() => {
    pipelineFocusRef.current = pipelineFocus ?? null;
  }, [pipelineFocus]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  const stsEventsOn = !!layers["sts-events"] || !!layers["sts-predictions"] || !!layers["energy-sts-zones"];
  useEffect(() => {
    if (!stsEventsOn) return;
    let cancelled = false;
    fetchSTSSummary()
      .then((s) => {
        if (!cancelled) setStsSummary(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stsEventsOn]);

  const setLayerGroup = useCallback((group: LayerGroupDef, on: boolean) => {
    setLayers((prev) => {
      const next = { ...prev };
      for (const id of group.memberIds) next[id] = on;
      return next;
    });
  }, []);

  useEffect(() => {
    setLayers(defaultLayerState(vertical));
    setWsState(vertical === "energy" ? "connecting" : "unavailable");
    setLastWsAt(undefined);
  }, [vertical]);

  const activeLayerCount = Object.values(layers).filter(Boolean).length;

  useEffect(() => {
    onRuntimeStatus?.({
      wsState: vertical === "energy" ? wsState : "unavailable",
      activeLayerCount,
      lastWsAt,
    });
  }, [wsState, activeLayerCount, lastWsAt, vertical, onRuntimeStatus]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    ensureMapRtlPlugin();
    const map = new maplibregl.Map({
      container: container.current,
      transformRequest: (url, resourceType) => {
        // Only send auth cookies to our own tile API — never to the public basemap host.
        if (resourceType === "Tile" && isOwnTileUrl(url)) {
          return { url, credentials: "include" };
        }
        return { url };
      },
      style: mapStyleForTheme(theme),
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
      applyBasemapTuning(map, theme);

      const sourcesAdded = new Set<string>();
      layersForVertical(vertical)
        .filter((l) => l.tileLayer && (vertical === "energy" || l.vertical !== "energy"))
        .forEach((layer) => {
          const src = mapSourceKey(layer);
          if (!sourcesAdded.has(src)) {
            map.addSource(src, {
              type: "vector",
              tiles: [`${apiBase()}/tiles/${layer.tileLayer}/{z}/{x}/{y}.mvt`],
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
        if (vertical === "energy" && layersRef.current["gem-asset-geometries"]) {
          const gemLayers = [
            "gem-asset-geometries-fill",
            "gem-asset-geometries-line",
            "gem-asset-geometries-point",
          ].filter((lid) => map.getLayer(lid) && map.getLayoutProperty(lid, "visibility") !== "none");
          if (gemLayers.length) {
            try {
              counts["gem-asset-geometries"] = map.queryRenderedFeatures({ layers: gemLayers }).length;
            } catch {
              /* source may still be refreshing */
            }
          }
        }
        setLayerCounts(counts);
      };
      map.on("idle", updateLayerCounts);

      map.on("click", (e) => {
        const feats = map.queryRenderedFeatures(e.point);
        const activeIds = new Set(layersForVertical(vertical).map((l) => l.id));
        const pipelineHits = feats.filter((f) => isPipelineLayer(f.layer.id));
        const gemPipelineHit = pipelineHits.find((f) =>
          String((f.properties as { osm_id?: string })?.osm_id ?? "").startsWith("gem:"),
        );
        const hit =
          gemPipelineHit ??
          feats.find(
            (f) =>
              activeIds.has(f.layer.id) ||
              f.layer.id === "sts-events" ||
              f.layer.id === "sts-predictions" ||
              f.layer.id === "storage-sites" ||
              isPipelineLayer(f.layer.id) ||
              isGemAssetGeometryLayer(f.layer.id) ||
              (vertical === "energy" && isVesselLayerId(f.layer.id)),
          );
        if (!hit) {
          clickPopupRef.current?.remove();
          clickPopupRef.current = null;
          onSelect(null);
          return;
        }
        const props = hit.properties as MapSelection;
        const layerId = isPipelineLayer(hit.layer.id)
          ? "pipelines"
          : isGemAssetGeometryLayer(hit.layer.id)
            ? "gem-asset-geometries"
          : isVesselLayerId(hit.layer.id)
            ? hit.layer.id.startsWith("live-vessels")
              ? "live-vessels"
              : "vessels"
            : hit.layer.id;
        const showQuickPopup = (next: MapSelection) => {
          clickPopupRef.current?.remove();
          hoverPopupRef.current?.remove();
          const popup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: false,
            className: "map-click-popup",
            offset: 16,
          });
          const node = buildQuickPopupNode(next, () => {
            popup.remove();
            if (clickPopupRef.current === popup) clickPopupRef.current = null;
            onSelect(next);
          });
          popup.setLngLat(e.lngLat).setDOMContent(node).addTo(map);
          clickPopupRef.current = popup;
        };
        if (layerId === "sts-events" || layerId === "sts-predictions") {
          showQuickPopup(stsSelectionFromProps(props as Record<string, unknown>, layerId));
          return;
        }
        if (layerId === "storage-sites") {
          showQuickPopup({
            ...props,
            id: undefined, // estimate row, not a registry entity — no dossier fetch
            name: props.name != null ? String(props.name) : "Storage site",
            _layer: "storage-sites",
            _entityType: "storage_site",
          });
          return;
        }
        showQuickPopup(selectionFromMapHit(props, layerId, e.lngLat));
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
          "line-color": [
            "case",
            ["!=", ["get", "rel"], "opportunity_chain"],
            "#5eb3ff",
            ["match", ["get", "geometry_source"], "pipeline_graph_edges", "#38bdf8", "asset_geometries", "#5dffc8", "#34d399"],
          ],
          "line-width": [
            "case",
            ["!=", ["get", "rel"], "opportunity_chain"],
            2,
            ["match", ["get", "geometry_source"], "inferred_direct_corridor", 2.2, 3.3],
          ],
          "line-opacity": ["match", ["get", "rel"], "opportunity_chain", 0.92, 0.65],
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "rel-points",
        type: "circle",
        source: "rel-lines",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": [
            "match",
            ["get", "role"],
            "supplier_asset",
            7,
            "buyer_asset",
            8,
            "physical_route",
            6,
            "cargo_or_vessel",
            6,
            5,
          ],
          "circle-color": [
            "match",
            ["get", "role"],
            "supplier_asset",
            "#5dffc8",
            "buyer_asset",
            "#fbbf24",
            "physical_route",
            "#38bdf8",
            "cargo_or_vessel",
            "#c084fc",
            "#5eb3ff",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0a0e14",
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "rel-point-labels",
        type: "symbol",
        source: "rel-lines",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["coalesce", ["get", "short_label"], ["get", "name"], ""],
          "text-size": 10,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#dbeafe",
          "text-halo-color": "#050914",
          "text-halo-width": 1.4,
        },
      });
      map.addSource("pipeline-focus-sites", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "pipeline-focus-sites",
        type: "circle",
        source: "pipeline-focus-sites",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "endpoint", 7, "facility", 9, 6],
          "circle-color": [
            "match",
            ["get", "kind"],
            "endpoint",
            "#5dffc8",
            "facility",
            "#fbbf24",
            "#5dffc8",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0a0e14",
          "circle-opacity": 0.92,
        },
      });

      if (vertical === "energy") {
        map.addSource("sts-events", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "signal_id",
        });
        map.addSource("sts-predictions", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "signal_id",
        });
        map.addSource("mcr-corridors", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          lineMetrics: true,
        });
        map.addSource("vessel-track", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("storage-sites", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "site_id",
        });
        map.addSource("gem-asset-geometries", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          promoteId: "asset_id",
        });
        addGemAssetGeometryLayers(map, !!layers["gem-asset-geometries"]);
        map.addLayer({
          id: "storage-sites-glow",
          type: "circle",
          source: "storage-sites",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["to-number", ["coalesce", ["get", "tank_count"], 1]],
              1, 6,
              20, 14,
              100, 24,
            ],
            "circle-color": MAP_COLORS.storageSite,
            "circle-blur": 1.2,
            "circle-opacity": 0.25,
          },
          layout: { visibility: layers["storage-sites"] ? "visible" : "none" },
        });
        map.addLayer({
          id: "storage-sites",
          type: "circle",
          source: "storage-sites",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["to-number", ["coalesce", ["get", "tank_count"], 1]],
              1, 3,
              20, 7,
              100, 12,
            ],
            "circle-color": MAP_COLORS.storageSite,
            "circle-opacity": 0.85,
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#03241a",
            "circle-stroke-opacity": 0.7,
          },
          layout: { visibility: layers["storage-sites"] ? "visible" : "none" },
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
          id: "sts-predictions-glow",
          type: "circle",
          source: "sts-predictions",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["to-number", ["coalesce", ["get", "future_pair_probability"], ["get", "confidence_score"]], 65],
              55,
              10,
              75,
              20,
              90,
              30,
            ],
            "circle-color": MAP_COLORS.stsPrediction,
            "circle-blur": 1.15,
            "circle-opacity": 0.22,
          },
          layout: { visibility: layers["sts-predictions"] ? "visible" : "none" },
        });
        map.addLayer({
          id: "sts-predictions",
          type: "circle",
          source: "sts-predictions",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["to-number", ["coalesce", ["get", "future_pair_probability"], ["get", "confidence_score"]], 65],
              55,
              5,
              75,
              9,
              90,
              14,
            ],
            "circle-color": MAP_COLORS.stsPrediction,
            "circle-opacity": 0.72,
            "circle-stroke-width": 1.2,
            "circle-stroke-color": "#03111f",
            "circle-stroke-opacity": 0.72,
          },
          layout: { visibility: layers["sts-predictions"] ? "visible" : "none" },
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
          const activeLayers = layersRef.current;
          if (activeLayers["sts-events"]) {
            fetchSTSEvents(bbox)
              .then((fc) => {
                const src = map.getSource("sts-events") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
          if (activeLayers["sts-predictions"]) {
            fetchSTSPredictions(bbox, 24)
              .then((fc) => {
                const src = map.getSource("sts-predictions") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
          if (activeLayers["mcr-corridors"]) {
            fetchMCRCorridors(bbox)
              .then((fc) => {
                const src = map.getSource("mcr-corridors") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
          if (activeLayers["storage-sites"]) {
            fetchStorageSites(bbox)
              .then((fc) => {
                const src = map.getSource("storage-sites") as maplibregl.GeoJSONSource | undefined;
                if (src) src.setData(fc);
              })
              .catch(() => {});
          }
          if (activeLayers["gem-asset-geometries"]) {
            fetchAssetGeometries(bbox)
              .then((fc) => {
                const src = map.getSource("gem-asset-geometries") as maplibregl.GeoJSONSource | undefined;
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

        const wsUrl = `${wsApiBase()}/api/core/ws?format=msgpack`;
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
            if (cancelled) return;
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
            if (cancelled) {
              ws?.close();
              return;
            }
            wsRetryMs = 2000;
            setWsState("connected");
            setVesselLayerVisibility(map, !!layers.vessels, true);
            const sendSub = () => {
              if (cancelled) return;
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
            if (cancelled) return;
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
      clickPopupRef.current?.remove();
      clickPopupRef.current = null;
      ws?.close();
      map.remove();
      mapRef.current = null;
    };
  }, [vertical, onSelect, theme]);

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
    const chainLines = (relationshipLines?.features ?? []).filter(
      (feature) =>
        feature.geometry?.type === "LineString" &&
        (feature.properties as Record<string, unknown> | null | undefined)?.rel === "opportunity_chain",
    );
    if (chainLines.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let points = 0;
    for (const feature of chainLines) {
      if (feature.geometry.type !== "LineString") continue;
      for (const coord of feature.geometry.coordinates) {
        if (coord.length < 2) continue;
        const [lng, lat] = coord;
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        bounds.extend([lng, lat]);
        points += 1;
      }
    }
    if (points >= 2) {
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 90, right: 430 },
        duration: 900,
        maxZoom: 7.5,
      });
    }
  }, [relationshipLines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let exitTimer: ReturnType<typeof setTimeout> | null = null;

    const syncFocus = () => {
      const focus = pipelineFocusRef.current;
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
      }
      if (!focus) {
        restorePipelineLayerFilters(map);
        const src = map.getSource("pipeline-focus-sites") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      if (!map.getLayer("pipelines")) return;
      applyPipelineFocusToMap(map, focus);
      if (countFocusedPipelinesInView(map, focus) === 0) {
        exitTimer = setTimeout(() => {
          const current = pipelineFocusRef.current;
          if (!current || current !== focus) return;
          if (countFocusedPipelinesInView(map, current) === 0) {
            onExitPipelineFocus?.();
          }
        }, 450);
      }
    };

    const onMapChange = () => {
      window.requestAnimationFrame(syncFocus);
    };

    map.on("moveend", onMapChange);
    map.on("idle", onMapChange);
    onMapChange();

    return () => {
      if (exitTimer) clearTimeout(exitTimer);
      map.off("moveend", onMapChange);
      map.off("idle", onMapChange);
    };
  }, [pipelineFocus, onExitPipelineFocus]);

  useEffect(() => {
    if (!pipelineFocus) return;
    setLayers((prev) => ({
      ...prev,
      pipelines: true,
      "energy-terminals": true,
      "energy-tank-farms": true,
      "energy-refineries": true,
      "storage-sites": prev["storage-sites"] ?? true,
    }));
  }, [pipelineFocus]);

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
      for (const lid of [
        "sts-events",
        "sts-events-glow",
        "sts-predictions",
        "sts-predictions-glow",
        "mcr-corridors",
        ...GEM_ASSET_GEOMETRY_LAYER_IDS,
      ] as const) {
        if (map.getLayer(lid)) {
          const key = lid === "sts-events-glow"
            ? "sts-events"
            : lid === "sts-predictions-glow"
              ? "sts-predictions"
              : isGemAssetGeometryLayer(lid)
                ? "gem-asset-geometries"
              : lid;
          map.setLayoutProperty(lid, "visibility", layers[key] ? "visible" : "none");
        }
      }
      if (layers["sts-events"] || layers["sts-predictions"] || layers["mcr-corridors"] || layers["gem-asset-geometries"]) {
        const bbox = bboxString(map);
        if (layers["sts-events"]) {
          fetchSTSEvents(bbox)
            .then((fc) => (map.getSource("sts-events") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
        if (layers["sts-predictions"]) {
          fetchSTSPredictions(bbox, 24)
            .then((fc) => (map.getSource("sts-predictions") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
        if (layers["mcr-corridors"]) {
          fetchMCRCorridors(bbox)
            .then((fc) => (map.getSource("mcr-corridors") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
        if (layers["gem-asset-geometries"]) {
          fetchAssetGeometries(bbox)
            .then((fc) => (map.getSource("gem-asset-geometries") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
            .catch(() => {});
        }
      }
      if (layers["storage-sites"]) {
        fetchStorageSites(bboxString(map))
          .then((fc) => (map.getSource("storage-sites") as maplibregl.GeoJSONSource | undefined)?.setData(fc))
          .catch(() => {});
      }
    }
    if (pipelineFocusRef.current && map.getLayer("pipelines")) {
      applyPipelineFocusToMap(map, pipelineFocusRef.current);
    } else if (!pipelineFocusRef.current) {
      restorePipelineLayerFilters(map);
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
          const groupDefs = layerGroupsForVertical(vertical);
          const groupRendered = new Set<string>();
          const groupHeaderShown = new Set<string>();
          const rows: ReactNode[] = [];

          for (const l of layersForVertical(vertical)) {
            if (l.hideInDrawer) continue;
            if (l.geoJsonSource && !l.tileLayer && vertical === "metals") continue;

            if (l.layerGroup) {
              const g = groupDefs.find((x) => x.id === l.layerGroup);
              if (!g || groupRendered.has(g.id)) continue;
              groupRendered.add(g.id);
              if (!groupHeaderShown.has(g.group)) {
                groupHeaderShown.add(g.group);
                rows.push(<div key={`gh-${g.group}`} className="layer-group-label">{g.group}</div>);
              }
              const on = isLayerGroupOn(g, layers);
              rows.push(
                <div key={g.id}>
                  <label className="layer-row">
                    <input
                      type="checkbox"
                      className="layer-switch"
                      checked={on}
                      onChange={(e) => setLayerGroup(g, e.target.checked)}
                    />
                    <span className="layer-row-swatches">
                      {g.swatches.map((s) => (
                        <span key={s.label} className="layer-row-swatch" style={{ background: s.color }} title={s.label} />
                      ))}
                    </span>
                    <span className="layer-row-label">{g.label}</span>
                  </label>
                  {g.drawerHint && (
                    <div className="layer-row-hint">
                      {g.drawerHint}
                      {g.id === "sts-intelligence" && on && stsSummary != null && (
                        <> · {stsSummary.events_7d ?? 0} events (7d), {stsSummary.predictions_active ?? 0} predictions active</>
                      )}
                    </div>
                  )}
                </div>,
              );
              continue;
            }

            if (l.group && !groupHeaderShown.has(l.group)) {
              groupHeaderShown.add(l.group);
              rows.push(<div key={`gh-${l.group}`} className="layer-group-label">{l.group}</div>);
            }
            const locked = layerLocked(l, entitlements);
            const count = formatCount(layerCounts[l.id]);
            rows.push(
              <div key={l.id}>
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
              </div>,
            );
          }
          return rows;
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
