import { useMemo } from 'react';
import { LayerGroup } from 'react-leaflet';
import { useGemPipelineGeoJson } from '../../lib/gemPipelines';
import { gemPipelineFeaturesToCanvas } from '../../lib/gemPipelineCanvasFeatures';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';

type Props = {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom: number;
  isDark?: boolean;
};

/** Always-visible GEM pipeline strokes (canvas). Hover/click stays on InfrastructureMapInteraction. */
export default function GemPipelineCanvasMapLayer({
  bbox,
  enabled,
  mapZoom,
  isDark = true,
}: Props) {
  const { data } = useGemPipelineGeoJson(bbox, enabled, mapZoom);
  const features = useMemo(() => {
    const raw = (data?.features ?? []).filter((feature) => {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const source = String(props.source || '');
      const layerId = String(props.layer_id || '');
      const fuel = String(props.fuel_group || '').toLowerCase();
      if (layerId === 'gem_gas_pipelines' || source.includes('ggit_gas')) return false;
      if (fuel === 'gas' && source.includes('ggit')) return false;
      return true;
    });
    return gemPipelineFeaturesToCanvas(raw, isDark);
  }, [data?.features, isDark]);

  if (!enabled || features.length === 0) return null;

  return (
    <LayerGroup>
      <CanvasLiveDealLayer
        features={features}
        mapZoom={mapZoom}
        selectedUid={null}
        onFeatureClick={() => {}}
        passThroughClicks
        isDark={isDark}
      />
    </LayerGroup>
  );
}
