import { useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { LayerGroup, LayersControl } from 'react-leaflet';
import {
  OsmPetroleumLayerId,
  defaultOsmLayerVisibility,
  osmPetroleumCoverageGapMessage,
  useOsmPetroleumCatalog,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumLayers';
import { isPetroleumMapboxDisabled, usePetroleumLayerCatalog } from '../../lib/petroleumLayers';
import {
  infrastructureLayerShouldRender,
  osmPointMvtOverviewShouldRender,
} from '../../lib/infrastructureLayer';
import { useI18n } from '../../lib/i18n';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import { osmVectorTilesEnabled } from '../../lib/osmPetroleumVectorTiles';
import type { OsmVectorVisibility } from '../../lib/osmPetroleumVectorStyle';
import { OsmVisibilityBridge } from './OsmVisibilityBridge';
import OsmPetroleumMapLayersGeoJson from './OsmPetroleumMapLayersGeoJson';
import { OSM_LABELS, OSM_MAP_LAYER_IDS } from '../../lib/osmPetroleumConstants';

const OsmPetroleumVectorMap = lazy(() => import('./OsmPetroleumVectorLayers'));

interface OsmPetroleumMapLayersProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  layerIds?: OsmPetroleumLayerId[];
  layerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  forcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  splitOilGasPipelineLayers?: boolean;
  isDark?: boolean;
}

function mergeVisibility(
  base: Record<OsmPetroleumLayerId, boolean>,
  overrides?: Partial<Record<OsmPetroleumLayerId, boolean>>,
): OsmVectorVisibility {
  return {
    pipelines: overrides?.pipelines ?? base.pipelines,
    refineries: overrides?.refineries ?? base.refineries,
    storage_terminals: overrides?.storage_terminals ?? base.storage_terminals,
  };
}

export default function OsmPetroleumMapLayers(props: OsmPetroleumMapLayersProps) {
  const {
    enabled,
    layerIds,
    layerVisibility,
    forcedLayers,
    mapZoom,
    onFeatureClick,
    bbox,
    splitOilGasPipelineLayers = false,
    isDark = true,
  } = props;
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const { data: osmCatalog } = useOsmPetroleumCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);
  const osmDefaults = useMemo(
    () => defaultOsmLayerVisibility(splitOilGasPipelineLayers ? true : mapboxOff),
    [mapboxOff, splitOilGasPipelineLayers],
  );
  const vectorMode = osmVectorTilesEnabled(osmCatalog);
  const activeIds = layerIds ?? OSM_MAP_LAYER_IDS;

  const [localVisibility, setLocalVisibility] = useState<OsmVectorVisibility>(() =>
    mergeVisibility(osmDefaults, layerVisibility),
  );

  const effectiveVisibility = useMemo(
    () => (layerVisibility != null ? mergeVisibility(osmDefaults, layerVisibility) : localVisibility),
    [layerVisibility, localVisibility, osmDefaults],
  );

  const setLayerVisible = useCallback((layerId: OsmPetroleumLayerId, on: boolean) => {
    setLocalVisibility((prev) => ({ ...prev, [layerId]: on }));
  }, []);

  const pipelinesToggled =
    enabled &&
    activeIds.includes('pipelines') &&
    (layerVisibility?.pipelines ?? localVisibility.pipelines ?? osmDefaults.pipelines);
  const { data: pipelinesData } = useOsmPetroleumLayerGeoJson(
    'pipelines',
    bbox,
    !vectorMode && pipelinesToggled && Boolean(bbox),
    mapZoom,
  );
  const coverageGapMessage = osmPetroleumCoverageGapMessage(pipelinesData);

  if (!enabled) return null;

  if (!vectorMode) {
    return (
      <OsmPetroleumMapLayersGeoJson
        {...props}
        coverageGapMessage={coverageGapMessage}
        splitOilGasPipelineLayers={splitOilGasPipelineLayers}
        isDark={isDark}
      />
    );
  }

  const visibleForRender = activeIds.filter((layerId) => {
    const toggled = effectiveVisibility[layerId];
    if (!toggled) return false;
    if (layerVisibility != null) {
      if (layerId === 'storage_terminals' || layerId === 'refineries') {
        return osmPointMvtOverviewShouldRender(mapZoom, Boolean(layerVisibility[layerId]));
      }
      return infrastructureLayerShouldRender(layerId, mapZoom, layerVisibility, forcedLayers ?? {});
    }
    return true;
  });

  const vectorVisibility: OsmVectorVisibility = {
    pipelines: visibleForRender.includes('pipelines'),
    refineries: visibleForRender.includes('refineries'),
    storage_terminals: visibleForRender.includes('storage_terminals'),
  };
  const osmActive = visibleForRender.length > 0;
  const osmLabel = t(
    'תשתיות נפט/גז OSM (צינורות, זיקוק, אחסון)',
    'Oil/gas infrastructure — OpenStreetMap (pipelines, refineries, storage)',
  );

  return (
    <>
      <LayersControl.Overlay checked={osmActive} name={osmLabel}>
        <LayerGroup>
          <Suspense fallback={null}>
            <OsmPetroleumVectorMap
              enabled={osmActive}
              visibility={vectorVisibility}
              catalogLayers={osmCatalog?.layers}
              isDark={isDark}
              splitOilGasPipelineLayers={splitOilGasPipelineLayers}
            />
          </Suspense>
        </LayerGroup>
      </LayersControl.Overlay>
      {layerVisibility == null &&
        activeIds.map((layerId) => {
          const label = t(OSM_LABELS[layerId][0], OSM_LABELS[layerId][1]);
          const checked = localVisibility[layerId] ?? osmDefaults[layerId];
          return (
            <LayersControl.Overlay key={layerId} checked={checked} name={label}>
              <OsmVisibilityBridge
                onEnable={() => setLayerVisible(layerId, true)}
                onDisable={() => setLayerVisible(layerId, false)}
              />
            </LayersControl.Overlay>
          );
        })}
    </>
  );
}
