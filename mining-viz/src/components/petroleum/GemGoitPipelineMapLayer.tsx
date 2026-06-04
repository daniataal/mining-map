import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { Layer } from 'leaflet';
import { useI18n } from '../../lib/i18n';
import {
  gemFuelGroupToPopupLayerId,
  gemPipelineStyle,
  useGemPipelineGeoJson,
} from '../../lib/gemPipelines';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';

interface GemGoitPipelineMapLayerProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  isDark?: boolean;
}

export default function GemGoitPipelineMapLayer({
  bbox,
  enabled,
  mapZoom,
  isDark = true,
}: GemGoitPipelineMapLayerProps) {
  const { t } = useI18n();
  const { data } = useGemPipelineGeoJson(bbox, enabled, mapZoom);
  const geojson = useMemo(
    () => data ?? { type: 'FeatureCollection' as const, features: [] },
    [data],
  );
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  if (!enabled) return null;

  const layerLabel = t(
    'צינורות GEM GOIT (נפט/NGL)',
    'Pipelines — GEM GOIT (CC BY)',
  );

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        <GeoJSON
          key="gem-goit-pipelines"
          data={geojson}
          style={(feature) => {
            const props = (feature?.properties || {}) as Record<string, unknown>;
            return gemPipelineStyle(
              String(props.fuel_group || ''),
              String(props.status || ''),
              isDark,
            );
          }}
          renderer={canvasRenderer}
          onEachFeature={(feature, layer: Layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            const popupLayerId = gemFuelGroupToPopupLayerId(String(props.fuel_group || ''));
            bindPetroleumFeaturePopup(
              layer,
              popupLayerId,
              props,
              feature.geometry ?? null,
            );
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
