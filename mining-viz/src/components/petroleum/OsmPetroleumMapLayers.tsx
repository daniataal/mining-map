import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import {
  OsmPetroleumLayerId,
  defaultOsmLayerVisibility,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumLayers';
import { isPetroleumMapboxDisabled, usePetroleumLayerCatalog } from '../../lib/petroleumLayers';
import { useI18n } from '../../lib/i18n';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import { createRefineryMapIcon } from './refineryMapIcon';
import {
  pipelineSubstancePopupLayerId,
  splitOsmPipelineFeatures,
  classifyPipelineSubstance,
} from '../../lib/pipelineSubstance';

const OSM_MAP_LAYER_IDS: OsmPetroleumLayerId[] = ['pipelines', 'refineries', 'storage_terminals'];

const OSM_STYLE: Record<OsmPetroleumLayerId, PathOptions> = {
  pipelines: {
    color: '#64748b',
    weight: 2.5,
    opacity: 0.75,
    dashArray: '5 4',
    lineCap: 'round',
  },
  refineries: { color: '#c2410c', weight: 1, fillColor: '#fb923c', fillOpacity: 0.85 },
  storage_terminals: { color: '#06b6d4', weight: 1, fillColor: '#22d3ee', fillOpacity: 0.85 },
};

const OSM_WATER_PIPELINE_STYLE: PathOptions = {
  color: '#0891b2',
  weight: 2.5,
  opacity: 0.8,
  dashArray: '2 6',
  lineCap: 'round',
};

const OSM_LABELS: Record<OsmPetroleumLayerId, [string, string]> = {
  pipelines: ['צינורות נפט/גז OSM', 'Oil/gas pipelines — OpenStreetMap'],
  refineries: ['זיקוק OSM (קהילה)', 'Refineries — OpenStreetMap (community)'],
  storage_terminals: ['מאגרי אחסון OSM', 'Tank storage — OpenStreetMap'],
};

const OSM_WATER_PIPELINE_LABEL: [string, string] = [
  'צינורות מים OSM',
  'Water pipelines — OpenStreetMap',
];

interface OsmLayerOverlayProps {
  layerId: 'pipelines' | 'refineries';
  label: string;
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
}

interface OsmPipelineGeoJsonProps {
  label: string;
  features: GeoJSON.Feature[];
  style: PathOptions;
  defaultVisible: boolean;
}

function OsmPipelineGeoJson({
  label,
  features,
  style,
  defaultVisible,
}: OsmPipelineGeoJsonProps) {
  const geojson = useMemo(
    () => ({ type: 'FeatureCollection' as const, features }),
    [features],
  );

  return (
    <LayersControl.Overlay checked={defaultVisible} name={label}>
      <LayerGroup>
        <GeoJSON
          key={label}
          data={geojson}
          style={style}
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            const substance = classifyPipelineSubstance(props);
            const popupLayerId = pipelineSubstancePopupLayerId(substance);
            bindPetroleumFeaturePopup(layer, popupLayerId, props, feature.geometry ?? null);
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}

function OsmPipelinesOverlays({
  label,
  bbox,
  enabled,
  defaultOilGasVisible,
}: {
  label: string;
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  defaultOilGasVisible: boolean;
}) {
  const { t } = useI18n();
  const { data } = useOsmPetroleumLayerGeoJson('pipelines', bbox, enabled);
  const { oilGas, water } = useMemo(() => {
    const features = data?.features ?? [];
    return splitOsmPipelineFeatures(features);
  }, [data]);

  return (
    <>
      <OsmPipelineGeoJson
        label={label}
        features={oilGas}
        style={OSM_STYLE.pipelines}
        defaultVisible={defaultOilGasVisible}
      />
      {water.length > 0 && (
        <OsmPipelineGeoJson
          label={t(OSM_WATER_PIPELINE_LABEL[0], OSM_WATER_PIPELINE_LABEL[1])}
          features={water}
          style={OSM_WATER_PIPELINE_STYLE}
          defaultVisible={false}
        />
      )}
    </>
  );
}

function OsmLayerOverlay({
  layerId,
  label,
  bbox,
  enabled,
  defaultVisible,
}: OsmLayerOverlayProps & { defaultVisible: boolean }) {
  const { data } = useOsmPetroleumLayerGeoJson(layerId, bbox, enabled);
  const style = OSM_STYLE[layerId];
  const geojson = useMemo(
    () => data ?? { type: 'FeatureCollection' as const, features: [] },
    [data],
  );
  const refineryIcon = useMemo(() => createRefineryMapIcon(false), []);

  if (layerId === 'pipelines') {
    return (
      <OsmPipelinesOverlays
        label={label}
        bbox={bbox}
        enabled={enabled}
        defaultOilGasVisible={defaultVisible}
      />
    );
  }

  return (
    <LayersControl.Overlay checked={defaultVisible} name={label}>
      <LayerGroup>
        <GeoJSON
          key={`osm-${layerId}`}
          data={geojson}
          style={style}
          pointToLayer={(_feature, latlng) =>
            L.marker(latlng, { icon: refineryIcon })
          }
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            bindPetroleumFeaturePopup(layer, 'refineries', props, feature.geometry ?? null);
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}

interface OsmPetroleumMapLayersProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  /** Subset of layers to mount (default: pipelines + refineries + storage). */
  layerIds?: OsmPetroleumLayerId[];
  /** Per-layer visibility when using external toggles (mining/global panel). */
  layerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
}

export default function OsmPetroleumMapLayers({
  bbox,
  enabled,
  layerIds,
  layerVisibility,
}: OsmPetroleumMapLayersProps) {
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);
  const osmDefaults = defaultOsmLayerVisibility(mapboxOff);
  const activeIds = layerIds ?? OSM_MAP_LAYER_IDS;

  if (!enabled) return null;

  return (
    <>
      {activeIds.map((layerId) => {
        const visible = layerVisibility?.[layerId] ?? osmDefaults[layerId];
        if (layerVisibility && !visible) return null;
        return (
          <OsmLayerOverlay
            key={layerId}
            layerId={layerId}
            label={t(OSM_LABELS[layerId][0], OSM_LABELS[layerId][1])}
            bbox={bbox}
            enabled={enabled}
            defaultVisible={visible}
          />
        );
      })}
    </>
  );
}
