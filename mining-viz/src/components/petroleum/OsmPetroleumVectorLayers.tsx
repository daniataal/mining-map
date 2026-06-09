import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MaplibreMap } from 'maplibre-gl';
import {
  applyOsmVectorVisibility,
  buildOsmPetroleumVectorStyle,
  OSM_PETROLEUM_VECTOR_PANE,
  type OsmVectorVisibility,
} from '../../lib/osmPetroleumVectorStyle';
import type { OsmPetroleumCatalogLayer } from '../../lib/osmPetroleumLayers';
import {
  registerOsmMvtMaplibreMap,
  unregisterOsmMvtMaplibreMap,
} from '../../lib/infrastructureMapInteraction';

type MaplibreGLLayer = L.MaplibreGL & {
  options: L.LeafletMaplibreGLOptions & { interactive?: boolean };
};

export interface OsmPetroleumVectorMapProps {
  enabled: boolean;
  visibility: OsmVectorVisibility;
  catalogLayers?: OsmPetroleumCatalogLayer[];
  isDark?: boolean;
  splitOilGasPipelineLayers?: boolean;
}

function ensurePetroleumVectorPane(map: L.Map): void {
  if (!map.getPane(OSM_PETROLEUM_VECTOR_PANE)) {
    map.createPane(OSM_PETROLEUM_VECTOR_PANE);
  }
  const pane = map.getPane(OSM_PETROLEUM_VECTOR_PANE);
  if (pane) {
    pane.style.zIndex = '380';
    pane.style.pointerEvents = 'none';
  }
}

function disableMaplibrePointerEvents(map: MaplibreMap): void {
  map.getCanvas().style.pointerEvents = 'none';
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
    const onLoad = () => {
      disableMaplibrePointerEvents(map);
      applyOsmVectorVisibility(map, props.visibility);
      registerOsmMvtMaplibreMap(map);
    };
    if (map.loaded()) {
      onLoad();
    } else {
      map.once('load', onLoad);
    }
    glLayer.on('remove', () => {
      unregisterOsmMvtMaplibreMap(map);
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
}

const OsmPetroleumVectorMapLayer = createLayerComponent<Layer, OsmPetroleumVectorMapProps>(
  createOsmVectorLayer,
  updateOsmVectorLayer,
);

export default function OsmPetroleumVectorMap(props: OsmPetroleumVectorMapProps) {
  if (!props.enabled) return null;
  return <OsmPetroleumVectorMapLayer {...props} />;
}
