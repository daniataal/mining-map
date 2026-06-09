import type { MutableRefObject } from 'react';
import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import { CanvasLiveDealLayer } from '../../lib/liveDealMap/liveDealCanvasLayer';
import type { LiveDealFeatureKind, LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

export interface CanvasLiveDealLayerProps {
  features: LiveDealMapFeature[];
  mapZoom: number;
  selectedUid: string | null;
  /** External hover (e.g. sidebar company list) — distinct from map mousemove hover. */
  hoveredUid?: string | null;
  onFeatureClick: (feature: LiveDealMapFeature) => void;
  passThroughClicks?: boolean;
  layerApiRef?: MutableRefObject<CanvasLiveDealLayer | null>;
  clusterPoints?: boolean;
  clusterKinds?: readonly LiveDealFeatureKind[];
  clusterMaxZoom?: number;
  clusterMinCount?: number;
  clusterGridMultiplier?: number;
  isDark?: boolean;
}

function createCanvasLiveDealLayer(
  props: CanvasLiveDealLayerProps,
  context: Parameters<typeof createElementObject>[1],
) {
  const layer = new CanvasLiveDealLayer({
    mapZoom: props.mapZoom,
    selectedUid: props.selectedUid,
    onFeatureClick: props.onFeatureClick,
    passThroughClicks: props.passThroughClicks,
    clusterPoints: props.clusterPoints,
    clusterKinds: props.clusterKinds,
    clusterMaxZoom: props.clusterMaxZoom,
    clusterMinCount: props.clusterMinCount,
    clusterGridMultiplier: props.clusterGridMultiplier,
    isDark: props.isDark,
  });
  layer.setFeatures(props.features);
  layer.setHoveredUid(props.hoveredUid ?? null);
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
  if (props.hoveredUid !== prevProps.hoveredUid) layer.setHoveredUid(props.hoveredUid ?? null);
  if (props.onFeatureClick !== prevProps.onFeatureClick) {
    layer.setOnFeatureClick(props.onFeatureClick);
  }
  if ((props.passThroughClicks ?? false) !== (prevProps.passThroughClicks ?? false)) {
    layer.setPassThroughClicks(props.passThroughClicks ?? false);
  }
  if (
    props.clusterPoints !== prevProps.clusterPoints ||
    props.clusterKinds !== prevProps.clusterKinds ||
    props.clusterMaxZoom !== prevProps.clusterMaxZoom ||
    props.clusterMinCount !== prevProps.clusterMinCount ||
    props.clusterGridMultiplier !== prevProps.clusterGridMultiplier ||
    props.isDark !== prevProps.isDark
  ) {
    layer.setClusterOptions({
      clusterPoints: props.clusterPoints,
      clusterKinds: props.clusterKinds,
      clusterMaxZoom: props.clusterMaxZoom,
      clusterMinCount: props.clusterMinCount,
      clusterGridMultiplier: props.clusterGridMultiplier,
      isDark: props.isDark,
    });
  }
}

const CanvasLiveDealLayerComponent = createLayerComponent<Layer, CanvasLiveDealLayerProps>(
  createCanvasLiveDealLayer,
  updateCanvasLiveDealLayer,
);

export default function CanvasLiveDealLayerView(props: CanvasLiveDealLayerProps) {
  return <CanvasLiveDealLayerComponent {...props} />;
}
