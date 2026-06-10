"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { FEATURE } from "@/lib/entitlements";
import {
  API_BASE,
  defaultLayerState,
  layersForVertical,
  LIMITED_AIS_COVERAGE_DETAIL,
  LIMITED_AIS_COVERAGE_LABEL,
  mapSourceKey,
  metalsMapLayersActive,
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
import { VesselDeadReckoning, parseWsFrame } from "@/lib/vesselDeadReckoning";
import type { MapSelection } from "./EntityDossierPanel";

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
  "#3dffb5",
  "#0a0e14",
];
const SELECTED_STROKE_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  3,
  1,
];
const SELECTED_LINE_WIDTH: ExpressionSpecification = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  6,
  3,
];

export type MapRuntimeStatus = {
  wsState: "connecting" | "connected" | "disconnected" | "unavailable";
  activeLayerCount: number;
  lastWsAt?: string;
  gulfAisLimited?: boolean;
};

function entityTypeForLayer(layerId: string): string {
  if (isVesselLayerId(layerId)) return "vessel";
  return "asset";
}

const VESSEL_TILE_LAYERS = ["vessels-no-heading", "vessels-ship"] as const;
const VESSEL_LIVE_LAYERS = ["live-vessels-no-heading", "live-vessels-ship"] as const;

function addVesselTileLayers(map: maplibregl.Map, src: string, sourceLayer: string, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  map.addLayer({
    id: "vessels-no-heading",
    type: "circle",
    source: src,
    "source-layer": sourceLayer,
    filter: vesselNoRotationFilter,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2, 10, 5],
      "circle-color": "#5eb3ff",
      "circle-opacity": 0.5,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
      "circle-stroke-opacity": 0.35,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: "vessels-ship",
    type: "symbol",
    source: src,
    "source-layer": sourceLayer,
    filter: vesselHasRotationFilter,
    layout: {
      visibility,
      "icon-image": "vessel-ship",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 8, 0.75, 12, 1],
      "icon-rotate": vesselIconRotate,
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function addLiveVesselLayers(map: maplibregl.Map, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  map.addLayer({
    id: "live-vessels-no-heading",
    type: "circle",
    source: "live-vessels",
    filter: vesselNoRotationFilter,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 6],
      "circle-color": "#7ec8ff",
      "circle-opacity": 0.55,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
      "circle-stroke-opacity": 0.4,
    },
    layout: { visibility },
  });
  map.addLayer({
    id: "live-vessels-ship",
    type: "symbol",
    source: "live-vessels",
    filter: vesselHasRotationFilter,
    layout: {
      visibility,
      "icon-image": "vessel-ship-live",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 8, 0.75, 12, 1],
      "icon-rotate": vesselIconRotate,
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function setVesselLayerVisibility(map: maplibregl.Map, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  for (const lid of [...VESSEL_TILE_LAYERS, ...VESSEL_LIVE_LAYERS]) {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", visibility);
  }
}

function mvtSourceLayer(tileLayer: string): string {
  switch (tileLayer) {
    case "vessels":
      return "vessels";
    case "metals-assets":
      return "metals_assets";
    case "pipelines":
      return "petroleum_osm";
    default:
      return "energy_assets";
  }
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

function addPointTileLayer(map: maplibregl.Map, layer: LayerDef, src: string, visible: boolean) {
  const filter = metalsAssetFilter(layer.id);
  map.addLayer({
    id: layer.id,
    type: "circle",
    source: src,
    "source-layer": mvtSourceLayer(layer.tileLayer!),
    ...(filter ? { filter } : {}),
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 8],
      "circle-color": layer.vertical === "metals" ? "#c9a227" : "#3dffb5",
      "circle-opacity": 0.85,
      "circle-stroke-width": SELECTED_STROKE_WIDTH,
      "circle-stroke-color": SELECTED_STROKE,
    },
    layout: { visibility: visible ? "visible" : "none" },
  });
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
      "line-width": SELECTED_LINE_WIDTH,
      "line-opacity": 0.9,
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
      "line-width": 2.5,
      "line-opacity": 0.8,
      "line-dasharray": [2, 6],
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "pipelines-hit",
    type: "line",
    source: src,
    "source-layer": "petroleum_osm",
    paint: {
      "line-color": "#000000",
      "line-width": 12,
      "line-opacity": 0,
    },
    layout: { visibility, "line-cap": "round", "line-join": "round" },
  });
}

function layerLocked(layer: LayerDef, entitlements?: Partial<Record<string, boolean>>): boolean {
  return !!layer.premium && !entitlements?.[FEATURE.mapPremiumLayers];
}

function interactiveLayerIds(vertical: "energy" | "metals"): string[] {
  const ids = layersForVertical(vertical).filter((l) => l.tileLayer).map((l) => l.id);
  if (vertical === "energy") {
    ids.push(...VESSEL_TILE_LAYERS, ...VESSEL_LIVE_LAYERS, ...PIPELINE_LAYER_IDS);
  }
  return ids;
}

function hoverLabel(props: Record<string, unknown>): string {
  const name = props.name != null ? String(props.name).trim() : "";
  const assetType = props.asset_type != null ? String(props.asset_type) : "";
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
    const map = new maplibregl.Map({
      container: container.current,
      transformRequest: (url, resourceType) => {
        if (resourceType === "Tile" && url.includes("/tiles/")) {
          return { url, credentials: "include" };
        }
        return { url };
      },
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: ["https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
            tileSize: 256,
            attribution: "© CARTO © OSM",
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
      center: [55, 25],
      zoom: 4,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    let ws: WebSocket | null = null;
    let moveEndHandler: (() => void) | null = null;
    let vesselMotion: VesselDeadReckoning | null = null;
    let cancelled = false;

    const setupMap = () => {
      if (cancelled) return;
      ensureVesselImages(map);

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
              promoteId: mvtSourceLayer(layer.tileLayer!),
            });
            sourcesAdded.add(src);
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

      map.on("click", (e) => {
        const feats = map.queryRenderedFeatures(e.point);
        const activeIds = new Set(layersForVertical(vertical).map((l) => l.id));
        const hit = feats.find(
          (f) =>
            activeIds.has(f.layer.id) ||
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
        hoverPopup.setLngLat(e.lngLat).setHTML(`<div class="map-hover-title">${hoverLabel(props)}</div>`).addTo(map);
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
        addLiveVesselLayers(map, !!layers.vessels);

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
        vesselMotion = new VesselDeadReckoning({
          getBbox: () => {
            const b = map.getBounds();
            return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
          },
          onFeatures: (features) => {
            const src = liveSrc();
            if (src) src.setData({ type: "FeatureCollection", features });
          },
        });

        const wsUrl = `${API_BASE.replace("http", "ws")}/api/core/ws?format=msgpack`;
        try {
          ws = new WebSocket(wsUrl);
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
            setWsState("connected");
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
            moveEndHandler = sendSub;
            map.on("moveend", sendSub);
            sendSub();
          };
          ws.onclose = () => setWsState("disconnected");
          ws.onerror = () => setWsState("disconnected");
        } catch {
          setWsState("unavailable");
          /* WS optional in dev */
        }
      }
    };

    if (map.loaded()) {
      setupMap();
    } else {
      map.once("load", setupMap);
    }

    return () => {
      cancelled = true;
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
        const vis = layers[l.id] ? "visible" : "none";
        for (const pid of PIPELINE_LAYER_IDS) {
          if (map.getLayer(pid)) map.setLayoutProperty(pid, "visibility", vis);
        }
        return;
      }
      if (map.getLayer(l.id)) {
        map.setLayoutProperty(l.id, "visibility", layers[l.id] ? "visible" : "none");
      }
    });
    if (vertical === "energy") {
      setVesselLayerVisibility(map, !!layers.vessels);
    }
  }, [layers, vertical]);

  const showMetalsEmpty = vertical === "metals" && !metalsMapLayersActive(layers);

  return (
    <div className="map-wrap">
      <div className="layer-drawer">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>LAYERS</div>
        {layersForVertical(vertical).map((l) => {
          const locked = layerLocked(l, entitlements);
          const input = (
            <input
              type="checkbox"
              checked={!!layers[l.id] && !locked}
              disabled={locked}
              onChange={(e) => setLayers((prev) => ({ ...prev, [l.id]: e.target.checked }))}
            />
          );
          return l.drawerHint ? (
            <div key={l.id}>
              <label style={locked ? { opacity: 0.55 } : undefined}>
                {input}
                {l.label}
                {locked ? " (plan)" : ""}
              </label>
              <div style={{ fontSize: 10, color: "var(--muted)", margin: "0 0 4px 1.35rem", lineHeight: 1.35 }}>
                {locked ? "Upgrade plan or sign in to unlock premium map layers." : l.drawerHint}
              </div>
            </div>
          ) : (
            <label key={l.id} style={locked ? { opacity: 0.55 } : undefined}>
              {input}
              {l.label}
              {locked ? " (plan)" : ""}
            </label>
          );
        })}
      </div>
      {vertical === "energy" && gulfAisLimited && (
        <div className="map-coverage-banner" role="status">
          <span className="badge warn compact">{LIMITED_AIS_COVERAGE_LABEL}</span>
          <strong>Gulf / Hormuz AIS</strong>
          <p>{LIMITED_AIS_COVERAGE_DETAIL}</p>
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
