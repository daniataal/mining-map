"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_BASE, LAYER_REGISTRY, defaultLayerState, layersForVertical } from "@/lib/layers";
import type { MapSelection } from "./EntityDossierPanel";

type VesselMsg = {
  mmsi: string;
  name?: string;
  vessel_type?: string;
  lat: number;
  lon: number;
  course?: number;
  speed_knots?: number;
  destination?: string;
  last_seen_at?: string;
  source?: string;
};

function vesselFeatures(vessels: VesselMsg[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: vessels.map((v) => ({
      type: "Feature",
      id: v.mmsi,
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      properties: {
        mmsi: v.mmsi,
        name: v.name ?? "",
        vessel_type: v.vessel_type ?? "",
        speed_knots: v.speed_knots ?? null,
        last_seen_at: v.last_seen_at ?? "",
        source: v.source ?? "live",
      },
    })),
  };
}

type Props = {
  vertical: "energy" | "metals";
  onSelect: (feature: MapSelection | null) => void;
  mapFocus?: { lat: number; lng: number } | null;
  relationshipLines?: FeatureCollection;
};

function entityTypeForLayer(layerId: string): string {
  if (layerId === "vessels" || layerId === "live-vessels") return "vessel";
  return "asset";
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
      "line-width": 3,
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

export default function IntelligenceMap({ vertical, onSelect, mapFocus, relationshipLines }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>(() => defaultLayerState(vertical));

  useEffect(() => {
    setLayers(defaultLayerState(vertical));
  }, [vertical]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
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
    let cancelled = false;

    const setupMap = () => {
      if (cancelled) return;

      layersForVertical(vertical).filter((l) => l.tileLayer).forEach((layer) => {
        const src = `src-${layer.id}`;
        map.addSource(src, {
          type: "vector",
          tiles: [`${API_BASE}/tiles/${layer.tileLayer}/{z}/{x}/{y}.mvt`],
          minzoom: layer.id === "pipelines" ? 4 : 0,
          maxzoom: 14,
        });
        if (layer.id === "pipelines") {
          addPipelineLayers(map, src, !!layers[layer.id]);
          return;
        }
        map.addLayer({
          id: layer.id,
          type: "circle",
          source: src,
          "source-layer": mvtSourceLayer(layer.tileLayer!),
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 8],
            "circle-color": layer.id === "vessels" ? "#5eb3ff" : layer.vertical === "metals" ? "#c9a227" : "#3dffb5",
            "circle-opacity": 0.85,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#0a0e14",
          },
          layout: { visibility: layers[layer.id] ? "visible" : "none" },
        });
      });

      map.on("click", (e) => {
        const feats = map.queryRenderedFeatures(e.point);
        const activeIds = new Set(layersForVertical(vertical).map((l) => l.id));
        const hit = feats.find(
          (f) =>
            activeIds.has(f.layer.id) ||
            isPipelineLayer(f.layer.id) ||
            (vertical === "energy" && f.layer.id === "live-vessels")
        );
        if (!hit) {
          onSelect(null);
          return;
        }
        const props = hit.properties as MapSelection;
        const layerId = isPipelineLayer(hit.layer.id) ? "pipelines" : hit.layer.id;
        onSelect({
          ...props,
          id: props.id != null ? String(props.id) : undefined,
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

      const liveFC: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
      map.addSource("live-vessels", { type: "geojson", data: liveFC });
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
        map.addLayer({
          id: "live-vessels",
          type: "circle",
          source: "live-vessels",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 10],
            "circle-color": "#7ec8ff",
            "circle-opacity": 0.95,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
          layout: { visibility: layers.vessels ? "visible" : "none" },
        });

        const liveByMMSI = new Map<string, Feature<Point>>();
        const applyLive = () => {
          const src = map.getSource("live-vessels") as maplibregl.GeoJSONSource | undefined;
          if (src) src.setData({ type: "FeatureCollection", features: [...liveByMMSI.values()] });
        };

        const wsUrl = API_BASE.replace("http", "ws") + "/api/core/ws";
        try {
          ws = new WebSocket(wsUrl);
          ws.onmessage = (ev) => {
            try {
              const msg = JSON.parse(ev.data as string) as {
                type?: string;
                vessels?: VesselMsg[];
                data?: VesselMsg;
                entity?: string;
              };
              if (msg.type === "snapshot" && Array.isArray(msg.vessels)) {
                liveByMMSI.clear();
                for (const v of msg.vessels) {
                  const f = vesselFeatures([v]).features[0] as Feature<Point>;
                  liveByMMSI.set(v.mmsi, f);
                }
                applyLive();
              } else if (msg.type === "delta" && msg.entity === "vessel" && msg.data?.mmsi) {
                const f = vesselFeatures([msg.data]).features[0] as Feature<Point>;
                liveByMMSI.set(msg.data.mmsi, f);
                applyLive();
              }
            } catch {
              /* ignore malformed ws payloads */
            }
          };
          ws.onopen = () => {
            const sendSub = () => {
              if (ws?.readyState !== WebSocket.OPEN) return;
              const b = map.getBounds();
              ws.send(JSON.stringify({
                bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
                zoom: map.getZoom(),
                layers: Object.keys(layers).filter((k) => layers[k]),
              }));
            };
            moveEndHandler = sendSub;
            map.on("moveend", sendSub);
            sendSub();
          };
        } catch {
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
      ws?.close();
      map.remove();
      mapRef.current = null;
    };
  }, [vertical, onSelect]);

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
    if (vertical === "energy" && map.getLayer("live-vessels")) {
      map.setLayoutProperty("live-vessels", "visibility", layers.vessels ? "visible" : "none");
    }
  }, [layers, vertical]);

  return (
    <div className="map-wrap">
      <div className="layer-drawer">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>LAYERS</div>
        {layersForVertical(vertical).map((l) => (
          <label key={l.id}>
            <input
              type="checkbox"
              checked={!!layers[l.id]}
              onChange={(e) => setLayers((prev) => ({ ...prev, [l.id]: e.target.checked }))}
            />
            {l.label}
          </label>
        ))}
      </div>
      <div id="map" ref={container} />
    </div>
  );
}
