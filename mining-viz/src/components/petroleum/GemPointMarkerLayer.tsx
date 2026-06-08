/**
 * GemPointMarkerLayer — unified GEM point-feature layer.
 *
 * Replaces the 95%-identical GemGgitLngMapLayer and GemGogptPlantMapLayer
 * components. Only the hook, style function, key prefix, and label differ.
 */
import { useMemo } from 'react';
import L from 'leaflet';
import { CircleMarker, LayerGroup, LayersControl } from 'react-leaflet';
import type { Layer, PathOptions } from 'leaflet';
import type { BaseGeoJsonResponse } from '../../lib/useLayerGeoJson';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import type { UseQueryResult } from '@tanstack/react-query';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import { pointCoords } from '../../lib/geojsonUtils';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';

interface GemPointMarkerLayerProps {
  /** Human-readable Layers Control label */
  label: string;
  /** Unique key prefix for React reconciliation */
  layerKey: string;
  /** Query result from a useGem*GeoJson or useLayerGeoJson hook */
  queryResult: UseQueryResult<BaseGeoJsonResponse>;
  /** Map the feature properties to a circle style */
  getStyle: (props: Record<string, unknown>) => PathOptions;
  /** Extract a unique key from feature for React list rendering */
  getFeatureKey?: (feature: GeoJSON.Feature, idx: number) => string;
  /** Leaflet popup layer id for the feature type */
  popupLayerId?: PetroleumLayerId;
  isDark?: boolean;
  enabled?: boolean;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

export default function GemPointMarkerLayer({
  label,
  layerKey,
  queryResult,
  getStyle,
  getFeatureKey,
  popupLayerId = 'refineries',
  enabled = true,
  onFeatureClick,
}: GemPointMarkerLayerProps) {
  const features = useMemo(() => queryResult.data?.features ?? [], [queryResult.data]);

  if (!enabled) return null;

  return (
    <LayersControl.Overlay checked name={label}>
      <LayerGroup>
        {features.map((feature, idx) => {
          const coords = pointCoords(feature.geometry ?? undefined);
          if (!coords) return null;
          const props = (feature.properties || {}) as Record<string, unknown>;
          const style = getStyle(props);
          const key = getFeatureKey
            ? getFeatureKey(feature, idx)
            : String(feature.id ?? `${layerKey}-${idx}`);
          const geometry = feature.geometry ?? null;
          return (
            <CircleMarker
              key={key}
              center={coords}
              pathOptions={style}
              eventHandlers={
                onFeatureClick
                  ? {
                      click: (e) => {
                        L.DomEvent.stopPropagation(e);
                        onFeatureClick({
                          layerId: 'refineries',
                          popupLayerId,
                          properties: props,
                          geometry,
                          coordinates: { lat: coords[0], lng: coords[1] },
                        });
                      },
                    }
                  : {
                      add: (e) => {
                        bindPetroleumFeaturePopup(
                          e.target as Layer,
                          popupLayerId,
                          props,
                          geometry,
                        );
                      },
                    }
              }
            />
          );
        })}
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
