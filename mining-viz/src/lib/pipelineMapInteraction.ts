import type { Layer, LayerGroup, LeafletMouseEvent, PathOptions, Polyline, Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import type { InfrastructureFeatureSelection } from '../features/infrastructure/InfrastructureFeatureDrawer';
import type { PetroleumLayerId } from './petroleumLayers';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';
import { bindPetroleumFeaturePopup } from '../components/petroleum/bindPetroleumPopup';
import {
  buildPipelineHoverSummary,
  isGemPipelineFeature,
  pipelineClickCoordinates,
} from './petroleumFeatureFields';
import { escapeHtml } from './htmlUtils';

/** Visible pipeline strokes — above OSM MVT, below hit targets. */
export const PIPELINE_VISIBLE_PANE = 'pipelineVisiblePane';

/** Above license canvas + OSM MVT so pipeline hits win pointer events. */
export const PIPELINE_INTERACTION_PANE = 'pipelineInteractionPane';

const PIPELINE_HIT_WEIGHT = 20;

export function ensurePipelineVisiblePane(map: LeafletMap): void {
  if (map.getPane(PIPELINE_VISIBLE_PANE)) return;
  map.createPane(PIPELINE_VISIBLE_PANE);
  const pane = map.getPane(PIPELINE_VISIBLE_PANE);
  if (pane) pane.style.zIndex = '520';
}

export function ensurePipelineInteractionPane(map: LeafletMap): void {
  ensurePipelineVisiblePane(map);
  if (map.getPane(PIPELINE_INTERACTION_PANE)) return;
  map.createPane(PIPELINE_INTERACTION_PANE);
  const pane = map.getPane(PIPELINE_INTERACTION_PANE);
  if (pane) pane.style.zIndex = '700';
}

function isPolylineLayer(layer: Layer): layer is Polyline {
  return (
    typeof (layer as Polyline).getLatLngs === 'function' &&
    typeof (layer as Polyline).setStyle === 'function' &&
    !('getRadius' in layer)
  );
}

function isLayerGroup(layer: Layer): layer is LayerGroup {
  return typeof (layer as LayerGroup).eachLayer === 'function';
}

function pipelineTooltipHtml(properties: Record<string, unknown>): string {
  const summary = buildPipelineHoverSummary(properties);
  const subtitle = summary.subtitle
    ? `<br/><span style="color:#cbd5e1;font-weight:500;">${escapeHtml(summary.subtitle)}</span>`
    : '';
  return `<div style="font-size:12px;line-height:1.35;"><span style="font-weight:700;color:#f8fafc;">${escapeHtml(summary.title)}</span>${subtitle}</div>`;
}

function bindOnePipelinePolyline(
  polyline: Polyline,
  options: PipelineMapInteractionOptions,
): void {
  const map = (polyline as Polyline & { _map?: LeafletMap })._map;
  if (map) {
    ensurePipelineVisiblePane(map);
    ensurePipelineInteractionPane(map);
  }

  const hit = L.polyline(polyline.getLatLngs() as L.LatLngExpression[], {
    weight: PIPELINE_HIT_WEIGHT,
    opacity: 0,
    color: '#000000',
    interactive: true,
    bubblingMouseEvents: false,
    className: 'pipeline-hit-area',
    pane: PIPELINE_INTERACTION_PANE,
  });

  const onClick = (event: LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(event);
    const coordinates = pipelineClickCoordinates(options.geometry ?? null, event.latlng);
    if (options.onFeatureClick) {
      options.onFeatureClick({
        layerId: isGemPipelineFeature(options.properties)
          ? 'pipelines'
          : (options.osmLayerId ?? 'pipelines'),
        popupLayerId: options.popupLayerId,
        properties: options.properties,
        geometry: options.geometry ?? null,
        coordinates,
      });
      return;
    }
    bindPetroleumFeaturePopup(
      polyline,
      options.popupLayerId,
      options.properties,
      options.geometry ?? null,
    );
    polyline.openPopup(event.latlng);
  };

  hit.bindTooltip(pipelineTooltipHtml(options.properties), {
    sticky: true,
    opacity: 1,
    className: 'pipeline-map-hover-tooltip',
    direction: 'top',
    offset: [0, -4],
  });
  hit.on('click', onClick);
  hit.on('mouseover', () => {
    polyline.setStyle({ weight: (polyline.options.weight ?? 3) + 1.5, opacity: 1 });
  });
  hit.on('mouseout', () => {
    polyline.setStyle({
      weight: options.visibleWeight ?? polyline.options.weight,
      opacity: options.visibleOpacity ?? polyline.options.opacity,
    });
  });

  polyline.on('add', function attachHit(this: Polyline & { _pipelineHit?: Polyline }) {
    const leafletMap = this._map;
    if (!leafletMap || this._pipelineHit) return;
    ensurePipelineInteractionPane(leafletMap);
    this._pipelineHit = hit;
    hit.addTo(leafletMap);
    hit.bringToFront();
  });

  polyline.on('remove', function detachHit(this: Polyline & { _pipelineHit?: Polyline }) {
    const attached = this._pipelineHit;
    if (attached && this._map) {
      this._map.removeLayer(attached);
    }
    this._pipelineHit = undefined;
  });

  const existingMap = (polyline as Polyline & { _map?: LeafletMap })._map;
  if (existingMap) {
    ensurePipelineInteractionPane(existingMap);
    hit.addTo(existingMap);
    hit.bringToFront();
    (polyline as Polyline & { _pipelineHit?: Polyline })._pipelineHit = hit;
  }
}

export type PipelineMapInteractionOptions = {
  layer: Layer;
  popupLayerId: PetroleumLayerId;
  properties: Record<string, unknown>;
  geometry?: GeoJSON.Geometry | null;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  osmLayerId?: OsmPetroleumLayerId;
  visibleWeight?: number;
  visibleOpacity?: number;
};

/** Hover tooltip + wide click target for pipeline polylines (OSM + GEM). */
export function bindPipelineMapInteraction(options: PipelineMapInteractionOptions): void {
  const { layer } = options;

  if (isLayerGroup(layer)) {
    layer.eachLayer((child) => {
      if (isPolylineLayer(child)) {
        bindOnePipelinePolyline(child, options);
      } else if (isLayerGroup(child)) {
        bindPipelineMapInteraction({ ...options, layer: child });
      }
    });
    return;
  }

  if (isPolylineLayer(layer)) {
    bindOnePipelinePolyline(layer, options);
  }
}

/** SVG renderer — canvas + preferCanvas breaks polyline hit testing. */
export function pipelineInteractiveRenderer(): L.Renderer {
  return L.svg({ padding: 0.5 });
}

export function pipelineVisibleStyle(style: PathOptions): PathOptions {
  return {
    ...style,
    interactive: false,
    pane: PIPELINE_VISIBLE_PANE,
    className: 'pipeline-visible-line',
    weight: typeof style.weight === 'number' ? style.weight + 1 : 4,
    opacity: typeof style.opacity === 'number' ? Math.min(1, style.opacity + 0.04) : 0.95,
  };
}
