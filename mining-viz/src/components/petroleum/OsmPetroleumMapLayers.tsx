import { useCallback, useMemo, useState, lazy, Suspense } from 'react';
import { LayersControl } from 'react-leaflet';
import {
  OsmPetroleumLayerId,
  defaultOsmLayerVisibility,
  osmPetroleumCoverageGapMessage,
  useOsmPetroleumCatalog,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumLayers';
import { isPetroleumMapboxDisabled, usePetroleumLayerCatalog } from '../../lib/petroleumLayers';
import { infrastructureLayerShouldRender } from '../../lib/infrastructureLayer';
import { useI18n } from '../../lib/i18n';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';
import type { OsmPetroleumCatalog } from '../../lib/osmPetroleumLayers';
import { osmVectorTilesEnabled } from '../../lib/osmPetroleumVectorTiles';
import type { OsmVectorVisibility } from '../../lib/osmPetroleumVectorStyle';
import { OsmVisibilityBridge } from './OsmVisibilityBridge';

const OsmPetroleumVectorMap = lazy(() => import('./OsmPetroleumVectorLayers'));

// GeoJSON fallback components (legacy path)
import OsmPetroleumMapLayersGeoJson from './OsmPetroleumMapLayersGeoJson';

const OSM_MAP_LAYER_IDS: OsmPetroleumLayerId[] = ['pipelines', 'refineries', 'storage_terminals'];

const OSM_LABELS: Record<OsmPetroleumLayerId, [string, string]> = {
  pipelines: ['צינורות נפט/גז OSM', 'Oil/gas pipelines — OpenStreetMap'],
  refineries: ['זיקוק OSM (קהילה)', 'Refineries — OpenStreetMap (community)'],
  storage_terminals: ['מאגרי אחסון OSM', 'Tank storage — OpenStreetMap'],
};

interface OsmPetroleumMapLayersProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  layerIds?: OsmPetroleumLayerId[];
  layerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  forcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  /** Oil & Gas view without Mapbox: split OSM pipelines into oil vs gas layer toggles. */
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
  const osmDefaults = useMemo(() => defaultOsmLayerVisibility(mapboxOff), [mapboxOff]);
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

  const pipelinesEnabled =
    enabled &&
    activeIds.includes('pipelines') &&
    (layerVisibility?.pipelines ?? localVisibility.pipelines ?? osmDefaults.pipelines);
  const { data: pipelinesData } = useOsmPetroleumLayerGeoJson(
    'pipelines',
    bbox,
    enabled && pipelinesEnabled && Boolean(bbox),
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
      return infrastructureLayerShouldRender(layerId, mapZoom, layerVisibility, forcedLayers ?? {});
    }
    return true;
  });

  const vectorVisibility: OsmVectorVisibility = {
    pipelines: visibleForRender.includes('pipelines'),
    refineries: visibleForRender.includes('refineries'),
    storage_terminals: visibleForRender.includes('storage_terminals'),
  };

  return (
    <>
      {coverageGapMessage ? (
        <div
          className="pointer-events-none absolute left-2 top-2 z-[500] max-w-xs rounded-md border border-amber-500/40 bg-amber-950/85 px-2 py-1 text-[11px] leading-snug text-amber-100 shadow"
          role="status"
        >
          {t(
            'שכבות OSM: אין נתונים שמורים — הריצו petroleum-osm worker או graph-sync.',
            coverageGapMessage,
          )}
        </div>
      ) : null}
      <Suspense fallback={null}>
        <OsmPetroleumVectorMap
          enabled={visibleForRender.length > 0}
          visibility={vectorVisibility}
          catalogLayers={osmCatalog?.layers}
          onFeatureClick={onFeatureClick}
        />
      </Suspense>
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
