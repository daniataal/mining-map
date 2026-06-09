import type { MutableRefObject } from 'react';
import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import type { MaritimeVessel } from '../../types';
import { CanvasVesselLayer } from '../../lib/vessels/canvasVesselLayer';

export interface CanvasVesselMarkersProps {
  mapZoom: number;
  selectedId: string | null;
  focusMode?: boolean;
  passThroughClicks?: boolean;
  onVesselClick: (vessel: MaritimeVessel) => void;
  formatTooltip: (vessel: MaritimeVessel) => HTMLElement | string;
  /** Filled when the Leaflet layer is constructed; parent pushes AIS rows via `setVessels` to avoid React diffing huge arrays. */
  layerApiRef?: MutableRefObject<CanvasVesselLayer | null>;
  /** Called when the canvas layer is mounted so the parent can flush pending AIS rows. */
  onLayerReady?: () => void;
}

function createCanvasVesselLayer(
  props: CanvasVesselMarkersProps,
  context: Parameters<typeof createElementObject>[1],
) {
  const layer = new CanvasVesselLayer({
    mapZoom: props.mapZoom,
    selectedId: props.selectedId,
    focusMode: props.focusMode ?? false,
    passThroughClicks: props.passThroughClicks ?? false,
    onVesselClick: props.onVesselClick,
    formatTooltip: props.formatTooltip,
  });
  if (props.layerApiRef) {
    props.layerApiRef.current = layer;
    layer.on('remove', () => {
      if (props.layerApiRef?.current === layer) props.layerApiRef.current = null;
    });
  }
  queueMicrotask(() => props.onLayerReady?.());
  return createElementObject(layer, context);
}

function updateCanvasVesselLayer(
  layer: CanvasVesselLayer,
  props: CanvasVesselMarkersProps,
  prevProps: CanvasVesselMarkersProps,
): void {
  if (props.onVesselClick !== prevProps.onVesselClick) {
    layer.setOnVesselClick(props.onVesselClick);
  }
  if (props.formatTooltip !== prevProps.formatTooltip) {
    layer.setFormatTooltip(props.formatTooltip);
  }
  if (props.mapZoom !== prevProps.mapZoom) {
    layer.setMapZoom(props.mapZoom);
  }
  if (props.selectedId !== prevProps.selectedId) {
    layer.setSelectedId(props.selectedId);
  }
  if ((props.focusMode ?? false) !== (prevProps.focusMode ?? false)) {
    layer.setFocusMode(props.focusMode ?? false);
  }
  if ((props.passThroughClicks ?? false) !== (prevProps.passThroughClicks ?? false)) {
    layer.setPassThroughClicks(props.passThroughClicks ?? false);
  }
}

const CanvasVesselMarkersLayer = createLayerComponent<Layer, CanvasVesselMarkersProps>(
  createCanvasVesselLayer,
  updateCanvasVesselLayer,
);

export default function CanvasVesselMarkers(props: CanvasVesselMarkersProps) {
  return <CanvasVesselMarkersLayer {...props} />;
}
