import type { MutableRefObject } from 'react';
import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import { CanvasLiveDealLayer } from '../../lib/liveDealMap/liveDealCanvasLayer';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

export interface CanvasLiveDealLayerProps {
  features: LiveDealMapFeature[];
  mapZoom: number;
  selectedUid: string | null;
  onFeatureClick: (feature: LiveDealMapFeature) => void;
  layerApiRef?: MutableRefObject<CanvasLiveDealLayer | null>;
}

function createCanvasLiveDealLayer(
  props: CanvasLiveDealLayerProps,
  context: Parameters<typeof createElementObject>[1],
) {
  const layer = new CanvasLiveDealLayer({
    mapZoom: props.mapZoom,
    selectedUid: props.selectedUid,
    onFeatureClick: props.onFeatureClick,
  });
  layer.setFeatures(props.features);
  if (props.layerApiRef) {
    props.layerApiRef.current = layer;
    layer.on('remove', () => {
      if (props.layerApiRef?.current === layer) props.layerApiRef.current = null;
    });
  }
  return createElementObject(layer, context);
}

function updateCanvasLiveDealLayer(
  layer: CanvasLiveDealLayer,
  props: CanvasLiveDealLayerProps,
  prevProps: CanvasLiveDealLayerProps,
): void {
  if (props.features !== prevProps.features) layer.setFeatures(props.features);
  if (props.mapZoom !== prevProps.mapZoom) layer.setMapZoom(props.mapZoom);
  if (props.selectedUid !== prevProps.selectedUid) layer.setSelectedUid(props.selectedUid);
  if (props.onFeatureClick !== prevProps.onFeatureClick) {
    layer.setOnFeatureClick(props.onFeatureClick);
  }
}

const CanvasLiveDealLayerComponent = createLayerComponent<Layer, CanvasLiveDealLayerProps>(
  createCanvasLiveDealLayer,
  updateCanvasLiveDealLayer,
);

export default function CanvasLiveDealLayerView(props: CanvasLiveDealLayerProps) {
  return <CanvasLiveDealLayerComponent {...props} />;
}
