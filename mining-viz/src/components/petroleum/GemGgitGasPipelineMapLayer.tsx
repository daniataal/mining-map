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

function isGgitGasFeature(props: Record<string, unknown>): boolean {
  const source = String(props.source || '');
  const layerId = String(props.layer_id || '');
  const fuel = String(props.fuel_group || '').toLowerCase();
  return (
    layerId === 'gem_gas_pipelines' ||
    source.includes('ggit_gas') ||
    (fuel === 'gas' && source.includes('ggit'))
  );
}

interface GemGgitGasPipelineMapLayerProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  isDark?: boolean;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

/** GGIT gas transmission segments (distinct from GOIT oil/NGL in gem_pipeline_segments). */
export default function GemGgitGasPipelineMapLayer({
  bbox,
  enabled,
  mapZoom,
  isDark = true,
  onFeatureClick,
}: GemGgitGasPipelineMapLayerProps) {
  const { t } = useI18n();
  const { data } = useGemPipelineGeoJson(bbox, enabled, mapZoom);
  const geojson = useMemo(() => {
    const features = (data?.features ?? []).filter((feature) =>
      isGgitGasFeature((feature.properties ?? {}) as Record<string, unknown>),
    );
    return { type: 'FeatureCollection' as const, features };
  }, [data?.features]);
  const svgRenderer = useMemo(() => pipelineInteractiveRenderer(), []);

  if (!enabled || geojson.features.length === 0) return null;

  const layerLabel = t('צינורות גז GEM GGIT', 'Gas pipelines — GEM GGIT (CC BY)');

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        <GeoJSON
          key="gem-ggit-gas-pipelines"
          data={geojson}
          style={(feature) => {
            const props = (feature?.properties || {}) as Record<string, unknown>;
            return pipelineVisibleStyle(gemPipelineStyle('gas', String(props.status || ''), isDark));
          }}
          renderer={svgRenderer}
          onEachFeature={
            onFeatureClick
              ? (feature, layer) => {
                  const props = (feature.properties || {}) as Record<string, unknown>;
                  const popupLayerId = gemFuelGroupToPopupLayerId('gas');
                  const lineStyle = gemPipelineStyle('gas', String(props.status || ''), isDark);
                  bindPipelineMapInteraction({
                    layer,
                    popupLayerId,
                    properties: props,
                    geometry: feature.geometry ?? null,
                    onFeatureClick,
                    visibleWeight: lineStyle.weight,
                    visibleOpacity: lineStyle.opacity,
                  });
                }
              : undefined
          }
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
