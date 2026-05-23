import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import type { PetroleumViewportBounds } from './petroleumLayers';

export type OsmPetroleumLayerId = 'pipelines' | 'refineries' | 'storage_terminals';

export interface OsmPetroleumLayerGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id: OsmPetroleumLayerId;
  label?: string;
  feature_count?: number;
  attribution?: string;
  license_note?: string;
  limitations?: string[];
}

export const OSM_PETROLEUM_LAYER_IDS: OsmPetroleumLayerId[] = [
  'pipelines',
  'refineries',
  'storage_terminals',
];

export const DEFAULT_OSM_LAYER_VISIBILITY: Record<OsmPetroleumLayerId, boolean> = {
  pipelines: false,
  refineries: false,
  storage_terminals: false,
};

/** When Mapbox is off, default OSM pipelines on (refineries / storage still opt-in). */
export function defaultOsmLayerVisibility(mapboxDisabled: boolean): Record<OsmPetroleumLayerId, boolean> {
  if (!mapboxDisabled) return { ...DEFAULT_OSM_LAYER_VISIBILITY };
  return { pipelines: true, refineries: false, storage_terminals: false };
}

export function useOsmPetroleumLayerGeoJson(
  layerId: OsmPetroleumLayerId,
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useQuery<OsmPetroleumLayerGeoJson>({
    queryKey: ['osm-petroleum-layer', layerId, bbox, mapZoom],
    queryFn: async () => {
      const { data } = await apiClient.get<OsmPetroleumLayerGeoJson>(
        `/api/petroleum/osm-layers/${layerId}`,
        {
          params: {
            ...(bbox
              ? {
                  south: bbox.south,
                  west: bbox.west,
                  north: bbox.north,
                  east: bbox.east,
                }
              : {}),
            ...(mapZoom != null && Number.isFinite(mapZoom)
              ? { zoom: Math.round(mapZoom * 10) / 10 }
              : {}),
          },
        },
      );
      return data;
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
