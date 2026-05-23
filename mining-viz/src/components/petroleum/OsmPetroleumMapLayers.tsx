import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { Layer, PathOptions } from 'leaflet';
import {
  OsmPetroleumLayerId,
  defaultOsmLayerVisibility,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumLayerId, PetroleumViewportBounds } from '../../lib/petroleumLayers';
import { isPetroleumMapboxDisabled, usePetroleumLayerCatalog } from '../../lib/petroleumLayers';
import { infrastructureLayerShouldRender } from '../../lib/infrastructureLayer';
import { useI18n } from '../../lib/i18n';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import { createRefineryMapIcon } from './refineryMapIcon';
import {
  pipelineSubstancePopupLayerId,
  splitOsmPipelineFeatures,
  classifyPipelineSubstance,
} from '../../lib/pipelineSubstance';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';

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

function getFeatureCoordinates(
  geometry: GeoJSON.Geometry | null | undefined,
): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    const [lng, lat] = geometry.coordinates[0] as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function osmLayerToPopupLayerId(
  layerId: OsmPetroleumLayerId,
  props: Record<string, unknown>,
): PetroleumLayerId {
  if (layerId === 'pipelines') {
    return pipelineSubstancePopupLayerId(classifyPipelineSubstance(props));
  }
  return 'refineries';
}

interface OsmLayerOverlayProps {
  layerId: OsmPetroleumLayerId;
  label: string;
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

interface OsmPipelineGeoJsonProps {
  label: string;
  features: GeoJSON.Feature[];
  style: PathOptions;
  defaultVisible: boolean;
}

function bindOsmFeatureInteraction(
  layer: Layer,
  osmLayerId: OsmPetroleumLayerId,
  props: Record<string, unknown>,
  geometry: GeoJSON.Geometry | null | undefined,
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void,
) {
  if (onFeatureClick) {
    layer.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      onFeatureClick({
        layerId: osmLayerId,
        popupLayerId: osmLayerToPopupLayerId(osmLayerId, props),
        properties: props,
        geometry: geometry ?? null,
        coordinates: getFeatureCoordinates(geometry),
      });
    });
    return;
  }
  const substance = classifyPipelineSubstance(props);
  const popupLayerId = pipelineSubstancePopupLayerId(substance);
  bindPetroleumFeaturePopup(layer, popupLayerId, props, geometry ?? null);
}

function OsmPipelineGeoJson({
  label,
  features,
  style,
  defaultVisible,
  osmLayerId,
  onFeatureClick,
}: OsmPipelineGeoJsonProps & {
  osmLayerId: 'pipelines';
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}) {
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
            bindOsmFeatureInteraction(
              layer,
              osmLayerId,
              props,
              feature.geometry ?? null,
              onFeatureClick,
            );
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
  mapZoom,
  onFeatureClick,
}: {
  label: string;
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  defaultOilGasVisible: boolean;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}) {
  const { t } = useI18n();
  const { data } = useOsmPetroleumLayerGeoJson('pipelines', bbox, enabled, mapZoom);
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
        osmLayerId="pipelines"
        onFeatureClick={onFeatureClick}
      />
      {water.length > 0 && (
        <OsmPipelineGeoJson
          label={t(OSM_WATER_PIPELINE_LABEL[0], OSM_WATER_PIPELINE_LABEL[1])}
          features={water}
          style={OSM_WATER_PIPELINE_STYLE}
          defaultVisible={false}
          osmLayerId="pipelines"
          onFeatureClick={onFeatureClick}
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
  mapZoom,
  onFeatureClick,
}: OsmLayerOverlayProps & { defaultVisible: boolean }) {
  const { data } = useOsmPetroleumLayerGeoJson(layerId, bbox, enabled, mapZoom);
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
        enabled={enabled && defaultVisible}
        defaultOilGasVisible={defaultVisible}
        mapZoom={mapZoom}
        onFeatureClick={onFeatureClick}
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
            bindOsmFeatureInteraction(
              layer,
              layerId,
              props,
              feature.geometry ?? null,
              onFeatureClick,
            );
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
  /** User toggled layers on at low zoom (bypass z≥9 gate). */
  forcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}

export default function OsmPetroleumMapLayers({
  bbox,
  enabled,
  layerIds,
  layerVisibility,
  forcedLayers,
  mapZoom,
  onFeatureClick,
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
        const toggled = layerVisibility?.[layerId] ?? osmDefaults[layerId];
        if (layerVisibility != null) {
          if (!toggled) return null;
          if (
            !infrastructureLayerShouldRender(layerId, mapZoom, layerVisibility, forcedLayers ?? {})
          ) {
            return null;
          }
        }
        const visible = layerVisibility?.[layerId] ?? osmDefaults[layerId];
        return (
          <OsmLayerOverlay
            key={layerId}
            layerId={layerId}
            label={t(OSM_LABELS[layerId][0], OSM_LABELS[layerId][1])}
            bbox={bbox}
            enabled={enabled && visible}
            defaultVisible={visible}
            mapZoom={mapZoom}
            onFeatureClick={onFeatureClick}
          />
        );
      })}
    </>
  );
}
