import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from './api';
import {
  catalogMapboxDisabled,
  isPetroleumMapboxDisabledEnv,
} from './petroleumMapMode';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';

export type PetroleumLayerId =
  | 'exploration'
  | 'production'
  | 'bid_rounds'
  | 'refineries'
  | 'oil_pipelines'
  | 'gas_pipelines';

export interface PetroleumLayerMeta {
  id: PetroleumLayerId;
  label: string;
  geometry: 'polygon' | 'point' | 'line';
  default_visible: boolean;
  attribution?: string;
  license_note?: string;
}

export interface PetroleumLayerCatalog {
  layers: PetroleumLayerMeta[];
  data_as_of: string;
  source_labels: string[];
  limitations: string[];
  mapbox_disabled?: boolean;
  env?: Record<string, string>;
}

export function isPetroleumMapboxDisabled(catalog?: PetroleumLayerCatalog | null): boolean {
  return isPetroleumMapboxDisabledEnv() || catalogMapboxDisabled(catalog);
}

export interface PetroleumLayerGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id: PetroleumLayerId;
  label?: string;
  bbox?: number[];
  zoom?: number;
  tile_count?: number;
  feature_count?: number;
  data_as_of?: string;
  attribution?: string;
  license_note?: string;
  limitations?: string[];
}

export interface PetroleumViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** One-time world bbox for oil & gas map — avoids refetching infrastructure on every pan. */
export const WORLD_PETROLEUM_PRELOAD_BBOX: PetroleumViewportBounds = {
  south: -55,
  west: -180,
  north: 84,
  east: 180,
};

export const PETROLEUM_LAYER_IDS: PetroleumLayerId[] = [
  'exploration',
  'production',
  'bid_rounds',
  'refineries',
  'oil_pipelines',
  'gas_pipelines',
];

/** Oil & gas map: only refineries on by default; other petroleum overlays are opt-in. */
export const DEFAULT_PETROLEUM_LAYER_VISIBILITY: Record<PetroleumLayerId, boolean> = {
  exploration: false,
  production: false,
  bid_rounds: false,
  refineries: true,
  oil_pipelines: false,
  gas_pipelines: false,
};

type OsmPetroleumCatalogResponse = {
  layers: Array<{
    id: OsmPetroleumLayerId;
    label: string;
    geometry?: string;
    default_visible?: boolean;
    attribution?: string;
    license_note?: string;
  }>;
  data_as_of?: string;
  source_labels?: string[];
  limitations?: string[];
  mapbox_disabled?: boolean;
};

function osmCatalogToPetroleumCatalog(data: OsmPetroleumCatalogResponse): PetroleumLayerCatalog {
  return {
    layers: data.layers.map((layer) => ({
      id: layer.id as PetroleumLayerId,
      label: layer.label,
      geometry: (layer.geometry === 'line' ? 'line' : layer.geometry === 'polygon' ? 'polygon' : 'point') as PetroleumLayerMeta['geometry'],
      default_visible: layer.default_visible ?? false,
      attribution: layer.attribution,
      license_note: layer.license_note,
    })),
    data_as_of: data.data_as_of ?? '',
    source_labels: data.source_labels ?? ['OpenStreetMap'],
    limitations: data.limitations ?? [],
    mapbox_disabled: data.mapbox_disabled ?? true,
  };
}

export function usePetroleumLayerCatalog(enabled = true) {
  const mapboxOff = isPetroleumMapboxDisabledEnv();
  return useQuery<PetroleumLayerCatalog>({
    queryKey: ['petroleum-layer-catalog', mapboxOff ? 'osm' : 'mapbox'],
    queryFn: async () => {
      if (mapboxOff) {
        const { data } = await apiClient.get<OsmPetroleumCatalogResponse>('/api/petroleum/osm-layers');
        return osmCatalogToPetroleumCatalog(data);
      }
      const { data } = await apiClient.get<PetroleumLayerCatalog>('/api/petroleum/layers');
      return data;
    },
    enabled,
    staleTime: 60 * 60_000,
  });
}

export function usePetroleumLayerGeoJson(
  layerId: PetroleumLayerId,
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number
) {
  return useQuery<PetroleumLayerGeoJson>({
    queryKey: ['petroleum-layer', layerId, bbox, mapZoom],
    queryFn: async () => {
      const { data } = await apiClient.get<PetroleumLayerGeoJson>(`/api/petroleum/layers/${layerId}`, {
        params: bbox
          ? {
              south: bbox.south,
              west: bbox.west,
              north: bbox.north,
              east: bbox.east,
              zoom: mapZoom,
            }
          : { zoom: mapZoom },
      });
      return data;
    },
    enabled: enabled && Boolean(bbox),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
}
