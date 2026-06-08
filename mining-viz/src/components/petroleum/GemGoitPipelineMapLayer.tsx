import { useMemo } from 'react';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import { useI18n } from '../../lib/i18n';
import {
  gemFuelGroupToPopupLayerId,
  gemPipelineStyle,
  useGemPipelineGeoJson,
} from '../../lib/gemPipelines';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import {
  bindPipelineMapInteraction,
  pipelineInteractiveRenderer,
  pipelineVisibleStyle,
} from '../../lib/pipelineMapInteraction';

interface GemGoitPipelineMapLayerProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  isDark?: boolean;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

export default function GemGoitPipelineMapLayer({
  bbox,
  enabled,
  mapZoom,
  isDark = true,
  onFeatureClick,
}: GemGoitPipelineMapLayerProps) {
  const { t } = useI18n();
  const { data } = useGemPipelineGeoJson(bbox, enabled, mapZoom);
  const geojson = useMemo(
    () => data ?? { type: 'FeatureCollection' as const, features: [] },
    [data],
  );
  const svgRenderer = useMemo(() => pipelineInteractiveRenderer(), []);

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
            return pipelineVisibleStyle(
              gemPipelineStyle(
                String(props.fuel_group || ''),
                String(props.status || ''),
                isDark,
              ),
            );
          }}
          renderer={svgRenderer}
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            const popupLayerId = gemFuelGroupToPopupLayerId(String(props.fuel_group || ''));
            const lineStyle = gemPipelineStyle(
              String(props.fuel_group || ''),
              String(props.status || ''),
              isDark,
            );
            bindPipelineMapInteraction({
              layer,
              popupLayerId,
              properties: props,
              geometry: feature.geometry ?? null,
              onFeatureClick,
              visibleWeight: lineStyle.weight,
              visibleOpacity: lineStyle.opacity,
            });
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
