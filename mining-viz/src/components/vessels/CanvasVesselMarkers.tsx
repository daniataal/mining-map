import { createElementObject, createLayerComponent } from '@react-leaflet/core';
import type { Layer } from 'leaflet';
import type { MaritimeVessel } from '../../types';
import { CanvasVesselLayer } from '../../lib/vessels/canvasVesselLayer';
import { toVesselDrawRecords } from '../../lib/vessels/vesselMarkerStyle';

export interface CanvasVesselMarkersProps {
  vessels: MaritimeVessel[];
  mapZoom: number;
  selectedId: string | null;
  onVesselClick: (vessel: MaritimeVessel) => void;
  formatTooltip: (vessel: MaritimeVessel) => HTMLElement | string;
}

function createCanvasVesselLayer(
  {
    vessels,
    mapZoom,
    selectedId,
    onVesselClick,
    formatTooltip,
  }: CanvasVesselMarkersProps,
  context: Parameters<typeof createElementObject>[1],
) {
  const layer = new CanvasVesselLayer({ mapZoom, selectedId, onVesselClick, formatTooltip });
  const records = toVesselDrawRecords(vessels, mapZoom, selectedId);
  layer.setVessels(vessels, records);
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
  if (
    props.vessels !== prevProps.vessels ||
    props.mapZoom !== prevProps.mapZoom ||
    props.selectedId !== prevProps.selectedId
  ) {
    const records = toVesselDrawRecords(props.vessels, props.mapZoom, props.selectedId);
    layer.setVessels(props.vessels, records);
  }
}

const CanvasVesselMarkersLayer = createLayerComponent<Layer, CanvasVesselMarkersProps>(
  createCanvasVesselLayer,
  updateCanvasVesselLayer,
);

export default function CanvasVesselMarkers(props: CanvasVesselMarkersProps) {
  return <CanvasVesselMarkersLayer {...props} />;
}
