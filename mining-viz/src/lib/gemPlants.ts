import { useLayerGeoJson } from './useLayerGeoJson';
import type { PetroleumViewportBounds } from './petroleumViewportBounds';

export { gemPlantMarkerStyle } from './gemPlantMapStyle';

export interface GemPlantGeoJson {
  type: 'FeatureCollection';
  features: GeoJSON.Feature[];
  layer_id?: string;
  label?: string;
  feature_count?: number;
  data_as_of?: string;
  attribution?: string;
  license_note?: string;
  limitations?: string[];
  coverage_gap?: boolean;
  hint?: string;
  db_feature_total?: number;
}

export function useGemPlantGeoJson(
  bbox: PetroleumViewportBounds | null,
  enabled: boolean,
  mapZoom?: number,
) {
  return useLayerGeoJson<GemPlantGeoJson>(
    '/api/petroleum/gem-plants',
    bbox,
    enabled,
    mapZoom,
  );
}
