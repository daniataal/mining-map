import { useLayerGeoJson } from './useLayerGeoJson';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export { gemLngMarkerStyle } from './gemLngMapStyle';

export interface GemLngGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id?: string;
  label?: string;
  feature_count?: number;
  attribution?: string;
  limitations?: string[];
  coverage_gap?: boolean;
}

export function useGemLngGeoJson(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useLayerGeoJson<GemLngGeoJson>(
    '/api/petroleum/gem-lng-terminals',
    bbox,
    enabled,
    mapZoom,
  );
}
