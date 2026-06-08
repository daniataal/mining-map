import { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import {
  useOsmPetroleumLayerGeoJson,
  type OsmPetroleumLayerId,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import {
  bindPipelineMapInteraction,
  pipelineInteractiveRenderer,
  pipelineVisibleStyle,
} from '../../lib/pipelineMapInteraction';
import {
  classifyPipelineSubstance,
  pipelineSubstancePopupLayerId,
  splitOsmPipelineFeaturesForOilGasLayers,
} from '../../lib/pipelineSubstance';

interface OsmPipelineInteractionOverlayProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  splitOilGasPipelineLayers?: boolean;
}

/**
 * Invisible wide hit targets on top of OSM MVT pipelines — MVT thin lines are hard to click.
 */
export default function OsmPipelineInteractionOverlay({
  bbox,
  enabled,
  mapZoom,
  onFeatureClick,
  splitOilGasPipelineLayers = false,
}: OsmPipelineInteractionOverlayProps) {
  const { data } = useOsmPetroleumLayerGeoJson('pipelines', bbox, enabled && Boolean(bbox), mapZoom);
  const renderer = useMemo(() => pipelineInteractiveRenderer(), []);

  const features = useMemo(() => {
    const raw = data?.features ?? [];
    if (!splitOilGasPipelineLayers) return raw;
    const { oil, gas } = splitOsmPipelineFeaturesForOilGasLayers(raw);
    return [...oil, ...gas];
  }, [data, splitOilGasPipelineLayers]);

  const geojson = useMemo(
    () => ({ type: 'FeatureCollection' as const, features }),
    [features],
  );

  if (!enabled || !bbox || !onFeatureClick || features.length === 0) return null;

  return (
    <GeoJSON
        key={`osm-pipeline-hit-${features.length}`}
        data={geojson}
        renderer={renderer}
        style={() =>
          pipelineVisibleStyle({
            color: '#fbbf24',
            weight: 3,
            opacity: 0,
          })
        }
        onEachFeature={(feature, layer) => {
          const props = (feature.properties || {}) as Record<string, unknown>;
          const popupLayerId = pipelineSubstancePopupLayerId(classifyPipelineSubstance(props));
          bindPipelineMapInteraction({
            layer,
            popupLayerId,
            properties: props,
            geometry: feature.geometry ?? null,
            onFeatureClick,
            osmLayerId: 'pipelines' satisfies OsmPetroleumLayerId,
            visibleWeight: 3,
            visibleOpacity: 0,
          });
        }}
      />
  );
}
