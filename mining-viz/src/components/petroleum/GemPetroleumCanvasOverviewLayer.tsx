import { useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
import type { BaseGeoJsonResponse } from '../../lib/useLayerGeoJson';
import type { UseQueryResult } from '@tanstack/react-query';
import { pointCoords } from '../../lib/geojsonUtils';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

type Props = {
  label: string;
  queryResult: UseQueryResult<BaseGeoJsonResponse>;
  enabled: boolean;
  mapZoom: number;
  /** Below this zoom, render coarse canvas clusters instead of CircleMarkers. */
  canvasMaxZoom?: number;
  color: string;
  kind: LiveDealMapFeature['kind'];
};

/**
 * Low-zoom canvas LOD for dense GEM point layers (GOGPT plants, extraction fields).
 * Above canvasMaxZoom the parent should render full GemPointMarkerLayer markers.
 */
export default function GemPetroleumCanvasOverviewLayer({
  label,
  queryResult,
  enabled,
  mapZoom,
  canvasMaxZoom = 9,
  color,
  kind,
}: Props) {
  const map = useMap();

  const features = useMemo<LiveDealMapFeature[]>(() => {
    if (!enabled || mapZoom > canvasMaxZoom) return [];
    const raw = queryResult.data?.features ?? [];
    return raw
      .map((feature, idx) => {
        const coords = pointCoords(feature.geometry ?? undefined);
        if (!coords) return null;
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const title =
          String(props.name || props.unit_name || props.field_name || props.project_name || 'GEM asset').trim();
        return {
          shape: 'point',
          uid: `gem-canvas:${kind}:${String(feature.id ?? idx)}`,
          id: String(feature.id ?? idx),
          kind,
          positions: [[coords[0], coords[1]]] as [number, number][],
          popupLat: coords[0],
          popupLng: coords[1],
          title,
          subtitle: String(props.country || props.status || '').trim() || null,
          tier: 'inferred',
          confidence: 0.7,
          sourceCount: 1,
          dealScore: 0.4,
          styleKey: kind,
          color,
          weight: 4,
          opacity: 0.85,
          data: props,
        } satisfies LiveDealMapFeature;
      })
      .filter((f): f is LiveDealMapFeature => f != null);
  }, [canvasMaxZoom, color, enabled, kind, mapZoom, queryResult.data?.features]);

  if (!enabled || mapZoom > canvasMaxZoom || features.length === 0) return null;

  return (
    <CanvasLiveDealLayer
      features={features}
      mapZoom={mapZoom}
      selectedUid={null}
      clusterPoints
      clusterKinds={[kind]}
      clusterMaxZoom={canvasMaxZoom}
      clusterMinCount={2}
      clusterGridMultiplier={3}
      onFeatureClick={(feature) => {
        const lat = feature.popupLat;
        const lng = feature.popupLng;
        if (lat == null || lng == null) return;
        L.popup({ className: 'gem-canvas-hover-tip' })
          .setLatLng([lat, lng])
          .setContent(
            `<div class="text-xs"><strong>${feature.title}</strong>${
              feature.subtitle ? `<br/><span class="text-slate-300">${feature.subtitle}</span>` : ''
            }</div>`,
          )
          .openOn(map);
      }}
    />
  );
}
