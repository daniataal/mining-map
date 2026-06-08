import { useMemo, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useGemPipelineGeoJson } from '../../lib/gemPipelines';
import {
  fetchOsmInfrastructureFeature,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import { buildPipelineHoverSummary, isGemPipelineFeature } from '../../lib/petroleumFeatureFields';
import {
  pickNearestPipelineFeature,
  pipelinePickToleranceM,
  pipelineSelectionFromPick,
} from '../../lib/pipelineMapPick';

interface PipelineMapInteractionBridgeProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  loadOsm: boolean;
  loadGem: boolean;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Map-level pipeline hit testing — does not rely on Leaflet polyline pointer events
 * (canvas/MVT/maplibre often block thin line hits).
 */
export default function PipelineMapInteractionBridge({
  bbox,
  enabled,
  mapZoom,
  loadOsm,
  loadGem,
  onFeatureClick,
}: PipelineMapInteractionBridgeProps) {
  const map = useMap();
  const hoverRef = useRef<L.Tooltip | null>(null);
  const pendingClickRef = useRef<AbortController | null>(null);

  const { data: gemData } = useGemPipelineGeoJson(bbox, enabled && loadGem, mapZoom);
  const { data: osmData } = useOsmPetroleumLayerGeoJson(
    'pipelines',
    bbox,
    enabled && loadOsm,
    mapZoom,
  );

  const features = useMemo(() => {
    const out: GeoJSON.Feature[] = [];
    if (loadGem) out.push(...(gemData?.features ?? []));
    if (loadOsm) out.push(...(osmData?.features ?? []));
    return out;
  }, [gemData, loadGem, loadOsm, osmData]);

  useMapEvents({
    mousemove(e) {
      if (!enabled || features.length === 0) {
        hoverRef.current?.remove();
        hoverRef.current = null;
        map.getContainer().style.cursor = '';
        return;
      }
      const tol = pipelinePickToleranceM(mapZoom) * 0.35;
      const pick = pickNearestPipelineFeature(features, e.latlng.lat, e.latlng.lng, tol);
      if (!pick) {
        hoverRef.current?.remove();
        hoverRef.current = null;
        map.getContainer().style.cursor = '';
        return;
      }
      map.getContainer().style.cursor = 'pointer';
      const summary = buildPipelineHoverSummary(
        (pick.feature.properties || {}) as Record<string, unknown>,
      );
      const html = `<div style="font-size:12px;line-height:1.35;"><span style="font-weight:700;color:#f8fafc;">${escapeHtml(summary.title)}</span>${
        summary.subtitle
          ? `<br/><span style="color:#cbd5e1;">${escapeHtml(summary.subtitle)}</span>`
          : ''
      }</div>`;
      if (!hoverRef.current) {
        hoverRef.current = L.tooltip({
          permanent: true,
          direction: 'top',
          className: 'pipeline-map-hover-tooltip',
          offset: [0, -8],
        });
      }
      hoverRef.current.setContent(html).setLatLng(e.latlng).addTo(map);
    },
    mouseout() {
      hoverRef.current?.remove();
      hoverRef.current = null;
      map.getContainer().style.cursor = '';
    },
    click(e) {
      if (!enabled || !onFeatureClick || features.length === 0) return;
      const tol = pipelinePickToleranceM(mapZoom);
      const pick = pickNearestPipelineFeature(features, e.latlng.lat, e.latlng.lng, tol);
      if (!pick) return;
      L.DomEvent.stop(e.originalEvent);

      const selection = pipelineSelectionFromPick(pick, { lat: e.latlng.lat, lng: e.latlng.lng });
      const props = (pick.feature.properties || {}) as Record<string, unknown>;
      if (isGemPipelineFeature(props)) {
        onFeatureClick(selection);
        return;
      }

      pendingClickRef.current?.abort();
      const controller = new AbortController();
      pendingClickRef.current = controller;

      void (async () => {
        let enriched = props;
        const osmId = props.osm_id;
        const osmType = props.osm_type;
        if (osmId != null && osmType != null && !controller.signal.aborted) {
          try {
            const full = await fetchOsmInfrastructureFeature(
              'pipelines',
              String(osmType),
              Number(osmId),
              controller.signal,
            );
            if (full) {
              enriched = { ...full, ...props, layer_id: 'pipelines' };
            }
          } catch {
            /* viewport GeoJSON props are enough when detail lookup fails */
          }
        }
        if (controller.signal.aborted) return;
        onFeatureClick({
          ...selection,
          properties: enriched,
        });
      })();
    },
  });

  return null;
}
