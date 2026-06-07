import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONFeature, Map as MaplibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import type { OsmPetroleumLayerId } from '../../lib/osmPetroleumLayers';
import { fetchOsmInfrastructureFeature } from '../../lib/osmPetroleumLayers';
import {
  applyOsmVectorVisibility,
  buildOsmPetroleumVectorStyle,
  OSM_PETROLEUM_VECTOR_PANE,
  OSM_VECTOR_CLICK_LAYERS,
  STYLE_LAYER_IDS,
  type OsmVectorVisibility,
} from '../../lib/osmPetroleumVectorStyle';
import type { OsmPetroleumCatalogLayer } from '../../lib/osmPetroleumLayers';
import {
  classifyPipelineSubstance,
  pipelineSubstancePopupLayerId,
} from '../../lib/pipelineSubstance';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';

type MaplibreGLLayer = L.MaplibreGL & {
  options: L.LeafletMaplibreGLOptions & { interactive?: boolean };
  _osmInteractionCleanup?: () => void;
};

const POINT_LAYER_IDS = new Set([
  STYLE_LAYER_IDS.refineries,
  STYLE_LAYER_IDS.storage,
]);

/** Prefer point features over pipeline lines when both overlap at the same pixel. */
function pickTopOsmFeature(features: GeoJSONFeature[]): GeoJSONFeature {
  const pointHit = features.find((f) => POINT_LAYER_IDS.has(f.layer.id));
  return pointHit ?? features[0];
}

function osmLayerFromProperties(props: Record<string, unknown>): OsmPetroleumLayerId {
  const layerId = String(props.layer_id ?? '');
  if (layerId === 'refineries' || layerId === 'storage_terminals' || layerId === 'pipelines') {
    return layerId;
  }
  return 'pipelines';
}

function osmLayerToPopupLayerId(
  layerId: OsmPetroleumLayerId,
  props: Record<string, unknown>,
): PetroleumLayerId {
  if (layerId === 'pipelines') {
    return pipelineSubstancePopupLayerId(classifyPipelineSubstance(props));
  }
  return 'refineries';
}

function featureSelectionFromMvt(
  props: Record<string, unknown>,
  lngLat: { lng: number; lat: number } | null,
): InfrastructureFeatureSelection {
  const layerId = osmLayerFromProperties(props);
  return {
    layerId,
    popupLayerId: osmLayerToPopupLayerId(layerId, props),
    properties: props,
    geometry: lngLat
      ? { type: 'Point', coordinates: [lngLat.lng, lngLat.lat] }
      : null,
    coordinates: lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null,
  };
}

function hoverLabelForFeature(props: Record<string, unknown>, layerId: OsmPetroleumLayerId): string {
  const name = String(props.name ?? '').trim();
  if (name) return name;
  const operator = String(props.operator ?? '').trim();
  if (operator) return operator;
  if (layerId === 'pipelines') return 'OSM pipeline';
  if (layerId === 'refineries') return 'OSM refinery';
  return 'OSM storage';
}

function attachInteractionHandlers(
  map: MaplibreMap,
  leafletMap: L.Map,
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void,
) {
  let hoverPopup: L.Popup | null = null;
  let pendingClick: AbortController | null = null;

  const interactiveLayers = () =>
    OSM_VECTOR_CLICK_LAYERS.filter((id) => map.getLayer(id));

  const onMove = (event: MapLayerMouseEvent) => {
    const layers = interactiveLayers();
    if (!layers.length) {
      map.getCanvas().style.cursor = '';
      hoverPopup?.remove();
      hoverPopup = null;
      return;
    }

    const features = map.queryRenderedFeatures(event.point, { layers });
    if (!features.length) {
      map.getCanvas().style.cursor = '';
      hoverPopup?.remove();
      hoverPopup = null;
      return;
    }

    const top = pickTopOsmFeature(features);
    const props = (top.properties ?? {}) as Record<string, unknown>;
    const layerId = osmLayerFromProperties(props);
    map.getCanvas().style.cursor = 'pointer';

    if (event.lngLat) {
      const label = hoverLabelForFeature(props, layerId);
      if (!hoverPopup) {
        hoverPopup = L.popup({
          closeButton: false,
          autoPan: false,
          className: 'osm-pipeline-hover-tip',
          offset: [0, -6],
        });
      }
      hoverPopup
        .setLatLng([event.lngLat.lat, event.lngLat.lng])
        .setContent(`<span class="text-xs font-semibold">${escapeHtml(label)}</span>`)
        .openOn(leafletMap);
      return;
    }

    hoverPopup?.remove();
    hoverPopup = null;
  };

  const onClick = (event: MapLayerMouseEvent) => {
    if (!onFeatureClick) return;
    const layers = interactiveLayers();
    if (!layers.length) return;

    const features = map.queryRenderedFeatures(event.point, { layers });
    if (!features.length) return;

    const top = pickTopOsmFeature(features);
    const baseProps = (top.properties ?? {}) as Record<string, unknown>;
    const layerId = osmLayerFromProperties(baseProps);
    const lngLat = event.lngLat ? { lng: event.lngLat.lng, lat: event.lngLat.lat } : null;

    pendingClick?.abort();
    pendingClick = new AbortController();

    void (async () => {
      let props = { ...baseProps };
      const osmId = props.osm_id;
      const osmType = props.osm_type;
      if (osmId != null && osmType != null && !pendingClick?.signal.aborted) {
        try {
          const full = await fetchOsmInfrastructureFeature(
            layerId,
            String(osmType),
            Number(osmId),
            pendingClick.signal,
          );
          if (full) {
            props = { ...full, ...baseProps, layer_id: layerId };
          }
        } catch {
          /* MVT props are enough when detail lookup fails */
        }
      }
      if (pendingClick?.signal.aborted) return;
      onFeatureClick(featureSelectionFromMvt(props, lngLat));
    })();
  };

  map.on('mousemove', onMove);
  map.on('click', onClick);

  return () => {
    pendingClick?.abort();
    map.off('mousemove', onMove);
    map.off('click', onClick);
    hoverPopup?.remove();
    hoverPopup = null;
    map.getCanvas().style.cursor = '';
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface OsmPetroleumVectorMapProps {
  enabled: boolean;
  visibility: OsmVectorVisibility;
  catalogLayers?: OsmPetroleumCatalogLayer[];
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  isDark?: boolean;
  splitOilGasPipelineLayers?: boolean;
}

function ensurePetroleumVectorPane(map: L.Map): void {
  if (map.getPane(OSM_PETROLEUM_VECTOR_PANE)) return;
  map.createPane(OSM_PETROLEUM_VECTOR_PANE);
  const pane = map.getPane(OSM_PETROLEUM_VECTOR_PANE);
  if (pane) pane.style.zIndex = '380';
}

function bindInteractions(
  glLayer: MaplibreGLLayer,
  map: MaplibreMap,
  leafletMap: L.Map,
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void,
) {
  glLayer._osmInteractionCleanup?.();
  glLayer._osmInteractionCleanup = attachInteractionHandlers(map, leafletMap, onFeatureClick);
}

function createOsmVectorLayer(
  props: OsmPetroleumVectorMapProps,
  context: Parameters<typeof createElementObject>[1],
) {
  ensurePetroleumVectorPane(context.map);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const style = buildOsmPetroleumVectorStyle(props.visibility, props.catalogLayers, origin, {
    isDark: props.isDark,
    splitOilGasPipelineLayers: props.splitOilGasPipelineLayers,
  });
  const glLayer = L.maplibreGL({
    style,
    interactive: true,
    padding: 0,
    pane: OSM_PETROLEUM_VECTOR_PANE,
  } as L.LeafletMaplibreGLOptions & { interactive?: boolean }) as MaplibreGLLayer;

  glLayer.on('add', () => {
    const map = glLayer.getMaplibreMap();
    const leafletMap = (glLayer as unknown as { _map?: L.Map })._map ?? context.map;
    const onLoad = () => {
      applyOsmVectorVisibility(map, props.visibility);
      bindInteractions(glLayer, map, leafletMap, props.onFeatureClick);
    };
    if (map.loaded()) {
      onLoad();
    } else {
      map.once('load', onLoad);
    }
    glLayer.on('remove', () => {
      glLayer._osmInteractionCleanup?.();
      glLayer._osmInteractionCleanup = undefined;
    });
  });

  return createElementObject(glLayer, context);
}

function updateOsmVectorLayer(
  layer: MaplibreGLLayer,
  props: OsmPetroleumVectorMapProps,
  prevProps: OsmPetroleumVectorMapProps,
) {
  const map = layer.getMaplibreMap?.();
  if (!map) return;

  if (
    props.visibility !== prevProps.visibility ||
    props.catalogLayers !== prevProps.catalogLayers ||
    props.isDark !== prevProps.isDark ||
    props.splitOilGasPipelineLayers !== prevProps.splitOilGasPipelineLayers
  ) {
    if (map.loaded()) {
      applyOsmVectorVisibility(map, props.visibility);
    }
  }

  if (props.onFeatureClick !== prevProps.onFeatureClick && map.loaded()) {
    const leafletMap = (layer as unknown as { _map?: L.Map })._map;
    if (leafletMap) {
      bindInteractions(layer, map, leafletMap, props.onFeatureClick);
    }
  }
}

const OsmPetroleumVectorMapLayer = createLayerComponent<Layer, OsmPetroleumVectorMapProps>(
  createOsmVectorLayer,
  updateOsmVectorLayer,
);

export default function OsmPetroleumVectorMap(props: OsmPetroleumVectorMapProps) {
  if (!props.enabled) return null;
  return <OsmPetroleumVectorMapLayer {...props} />;
}
