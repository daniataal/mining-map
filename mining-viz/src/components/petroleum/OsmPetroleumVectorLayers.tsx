import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import L from 'leaflet';
import '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MaplibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import type { OsmPetroleumLayerId } from '../../lib/osmPetroleumLayers';
import {
  applyOsmVectorVisibility,
  buildOsmPetroleumVectorStyle,
  OSM_VECTOR_CLICK_LAYERS,
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
};

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

export interface OsmPetroleumVectorMapProps {
  enabled: boolean;
  visibility: OsmVectorVisibility;
  catalogLayers?: OsmPetroleumCatalogLayer[];
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

function attachClickHandler(
  map: MaplibreMap,
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void,
) {
  if (!onFeatureClick) return () => {};
  const handler = (event: MapLayerMouseEvent) => {
    const features = map.queryRenderedFeatures(event.point, {
      layers: OSM_VECTOR_CLICK_LAYERS.filter((id) => map.getLayer(id)),
    });
    if (!features.length) return;
    const top = features[0];
    const props = (top.properties ?? {}) as Record<string, unknown>;
    onFeatureClick(
      featureSelectionFromMvt(props, event.lngLat ? { lng: event.lngLat.lng, lat: event.lngLat.lat } : null),
    );
  };
  map.on('click', handler);
  return () => {
    map.off('click', handler);
  };
}

function createOsmVectorLayer(
  props: OsmPetroleumVectorMapProps,
  context: Parameters<typeof createElementObject>[1],
) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const style = buildOsmPetroleumVectorStyle(props.visibility, props.catalogLayers, origin);
  const glLayer = L.maplibreGL({
    style,
    interactive: true,
    padding: 0,
  } as L.LeafletMaplibreGLOptions & { interactive?: boolean }) as MaplibreGLLayer;

  glLayer.on('add', () => {
    const map = glLayer.getMaplibreMap();
    const onLoad = () => {
      applyOsmVectorVisibility(map, props.visibility);
      const cleanupClick = attachClickHandler(map, props.onFeatureClick);
      map.once('remove', cleanupClick);
    };
    if (map.loaded()) {
      onLoad();
    } else {
      map.once('load', onLoad);
    }
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
    props.catalogLayers !== prevProps.catalogLayers
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
