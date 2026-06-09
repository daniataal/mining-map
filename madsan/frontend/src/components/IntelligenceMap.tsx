"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_BASE, LAYER_REGISTRY } from "@/lib/layers";
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

export default function IntelligenceMap({ vertical, onSelect, mapFocus, relationshipLines }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [layers, setLayers] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAYER_REGISTRY.map((l) => [l.id, l.defaultOn && (l.vertical === vertical || l.vertical === "shared")]))
  );

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

    LAYER_REGISTRY.filter((l) => l.tileLayer).forEach((layer) => {
      const src = `src-${layer.id}`;
      map.addSource(src, {
        type: "vector",
        tiles: [`${API_BASE}/tiles/${layer.tileLayer}/{z}/{x}/{y}.mvt`],
        minzoom: 0,
        maxzoom: 14,
      });
      map.addLayer({
        id: layer.id,
        type: "circle",
        source: src,
        "source-layer": layer.tileLayer === "vessels" ? "vessels" : layer.tileLayer === "metals-assets" ? "metals_assets" : "energy_assets",
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
      const hit = feats.find((f) => LAYER_REGISTRY.some((l) => l.id === f.layer.id) || f.layer.id === "live-vessels");
      if (!hit) {
        onSelect(null);
        return;
      }
      const props = hit.properties as MapSelection;
      onSelect({
        ...props,
        id: props.id != null ? String(props.id) : undefined,
        mmsi: props.mmsi != null ? String(props.mmsi) : undefined,
        name: props.name != null ? String(props.name) : undefined,
        _layer: hit.layer.id,
        _entityType: entityTypeForLayer(hit.layer.id),
      });
    });

    const liveFC: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
    map.addSource("live-vessels", { type: "geojson", data: liveFC });
    const emptyLines: FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource("rel-lines", { type: "geojson", data: emptyLines });
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
    let ws: WebSocket | null = null;
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
        map.on("moveend", sendSub);
        sendSub();
      };
    } catch {
      /* WS optional in dev */
    }

    return () => {
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
    LAYER_REGISTRY.forEach((l) => {
      if (map.getLayer(l.id)) {
        map.setLayoutProperty(l.id, "visibility", layers[l.id] ? "visible" : "none");
      }
    });
    if (map.getLayer("live-vessels")) {
      map.setLayoutProperty("live-vessels", "visibility", layers.vessels ? "visible" : "none");
    }
  }, [layers]);

  return (
    <div className="map-wrap">
      <div className="layer-drawer">
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>LAYERS</div>
        {LAYER_REGISTRY.filter((l) => l.vertical === vertical || l.vertical === "shared").map((l) => (
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
