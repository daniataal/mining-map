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
import {
  infrastructureLayerShouldRender,
  pipelineLeafletShouldFetch,
} from '../../lib/infrastructureLayer';
import { useI18n } from '../../lib/i18n';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import {
  pipelineSubstancePopupLayerId,
  splitOsmPipelineFeatures,
  splitOsmPipelineFeaturesForOilGasLayers,
  classifyPipelineSubstance,
} from '../../lib/pipelineSubstance';
import type { InfrastructureFeatureSelection } from '../../features/infrastructure/InfrastructureFeatureDrawer';

const OSM_MAP_LAYER_IDS: OsmPetroleumLayerId[] = ['pipelines', 'refineries', 'storage_terminals'];

const OSM_STYLE: Record<OsmPetroleumLayerId, PathOptions> = {
  pipelines: {
    color: '#fbbf24',
    weight: 3,
    opacity: 0.9,
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

const OIL_GAS_PIPELINE_LABELS = {
  oil_pipelines: ['צינורות נפט', 'Oil pipelines'] as [string, string],
  gas_pipelines: ['צינורות גז', 'Gas pipelines'] as [string, string],
};

function oilGasPipelineStyle(layerId: 'oil_pipelines' | 'gas_pipelines', isDark: boolean): PathOptions {
  if (layerId === 'oil_pipelines') {
    return {
      color: isDark ? '#fbbf24' : '#0f172a',
      weight: 3,
      opacity: isDark ? 0.92 : 0.88,
      lineCap: 'round',
      lineJoin: 'round',
    };
  }
  return {
    color: isDark ? '#38bdf8' : '#0284c7',
    weight: 2.6,
    opacity: 0.88,
    dashArray: isDark ? undefined : '6 4',
    lineCap: 'round',
  };
}

const OSM_WATER_PIPELINE_LABEL: [string, string] = [
  'צינורות מים OSM',
  'Water pipelines — OpenStreetMap',
];

function OsmOilGasPipelineOverlays({
  bbox,
  enabled,
  defaultVisible,
  mapZoom,
  isDark,
  onFeatureClick,
}: {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  defaultVisible: boolean;
  mapZoom?: number;
  isDark: boolean;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
}) {
  const { t } = useI18n();
  const { data } = useOsmPetroleumLayerGeoJson('pipelines', bbox, enabled, mapZoom);
  const { oil, gas } = useMemo(
    () => splitOsmPipelineFeaturesForOilGasLayers(data?.features ?? []),
    [data],
  );

  return (
    <>
      <OsmPipelineGeoJson
        label={t(OIL_GAS_PIPELINE_LABELS.oil_pipelines[0], OIL_GAS_PIPELINE_LABELS.oil_pipelines[1])}
        features={oil}
        style={oilGasPipelineStyle('oil_pipelines', isDark)}
        defaultVisible={defaultVisible}
        osmLayerId="pipelines"
        onFeatureClick={onFeatureClick}
      />
      <OsmPipelineGeoJson
        label={t(OIL_GAS_PIPELINE_LABELS.gas_pipelines[0], OIL_GAS_PIPELINE_LABELS.gas_pipelines[1])}
        features={gas}
        style={oilGasPipelineStyle('gas_pipelines', isDark)}
        defaultVisible={defaultVisible}
        osmLayerId="pipelines"
        onFeatureClick={onFeatureClick}
      />
    </>
  );
}

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
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  return (
    <LayersControl.Overlay checked={defaultVisible} name={label}>
      <LayerGroup>
        <GeoJSON
          key={label}
          data={geojson}
          style={style}
          renderer={canvasRenderer}
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
  splitOilGasPipelineLayers,
  isDark,
}: OsmLayerOverlayProps & {
  defaultVisible: boolean;
  splitOilGasPipelineLayers?: boolean;
  isDark?: boolean;
}) {
  const { data } = useOsmPetroleumLayerGeoJson(layerId, bbox, enabled, mapZoom);
  const style = OSM_STYLE[layerId];
  const geojson = useMemo(
    () => data ?? { type: 'FeatureCollection' as const, features: [] },
    [data],
  );
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  if (layerId === 'pipelines') {
    if (splitOilGasPipelineLayers) {
      return (
        <OsmOilGasPipelineOverlays
          bbox={bbox}
          enabled={enabled && defaultVisible}
          defaultVisible={defaultVisible}
          mapZoom={mapZoom}
          isDark={isDark ?? true}
          onFeatureClick={onFeatureClick}
        />
      );
    }
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
          renderer={canvasRenderer}
          pointToLayer={(_feature, latlng) =>
            L.circleMarker(latlng, {
              renderer: canvasRenderer,
              radius: layerId === 'refineries' ? 5 : 4,
              ...style,
            })
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

interface OsmPetroleumMapLayersGeoJsonProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  layerIds?: OsmPetroleumLayerId[];
  layerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  forcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  coverageGapMessage?: string | null;
  splitOilGasPipelineLayers?: boolean;
  isDark?: boolean;
}

export interface OsmPipelineLeafletLayersProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  layerVisibility?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  forcedLayers?: Partial<Record<OsmPetroleumLayerId, boolean>>;
  mapZoom?: number;
  onFeatureClick?: (selection: InfrastructureFeatureSelection) => void;
  coverageGapMessage?: string | null;
  splitOilGasPipelineLayers?: boolean;
  isDark?: boolean;
  defaultVisible?: boolean;
}

/** Leaflet GeoJSON + canvas for OSM pipelines (static snapshot — no MVT). */
export function OsmPipelineLeafletLayers({
  bbox,
  enabled,
  layerVisibility,
  forcedLayers,
  mapZoom,
  onFeatureClick,
  coverageGapMessage,
  splitOilGasPipelineLayers = false,
  isDark = true,
  defaultVisible = true,
}: OsmPipelineLeafletLayersProps) {
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);
  const osmDefaults = defaultOsmLayerVisibility(splitOilGasPipelineLayers ? true : mapboxOff);

  if (!enabled) return null;

  const toggled = layerVisibility?.pipelines ?? defaultVisible ?? osmDefaults.pipelines;
  if (!toggled) return null;
  if (!pipelineLeafletShouldFetch(mapZoom, toggled)) return null;

  const visible = toggled;
  const label = t(OSM_LABELS.pipelines[0], OSM_LABELS.pipelines[1]);

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
      <OsmLayerOverlay
        layerId="pipelines"
        label={label}
        bbox={bbox}
        enabled={enabled && visible}
        defaultVisible={visible}
        mapZoom={mapZoom}
        onFeatureClick={onFeatureClick}
        splitOilGasPipelineLayers={splitOilGasPipelineLayers}
        isDark={isDark}
      />
    </>
  );
}

/** GeoJSON + canvas fallback when MVT vector tiles are disabled. */
export default function OsmPetroleumMapLayersGeoJson({
  bbox,
  enabled,
  layerIds,
  layerVisibility,
  forcedLayers,
  mapZoom,
  onFeatureClick,
  coverageGapMessage,
  splitOilGasPipelineLayers = false,
  isDark = true,
}: OsmPetroleumMapLayersGeoJsonProps) {
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);
  /** Oil & Gas split toggles replace Mapbox pipelines — default OSM pipelines on. */
  const osmDefaults = defaultOsmLayerVisibility(splitOilGasPipelineLayers ? true : mapboxOff);
  const activeIds = layerIds ?? OSM_MAP_LAYER_IDS;

  if (!enabled) return null;

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
      {activeIds.map((layerId) => {
        const toggled = layerVisibility?.[layerId] ?? osmDefaults[layerId];
        if (layerId === 'pipelines') {
          if (!pipelineLeafletShouldFetch(mapZoom, toggled)) return null;
        } else if (layerVisibility != null) {
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
            splitOilGasPipelineLayers={splitOilGasPipelineLayers}
            isDark={isDark}
          />
        );
      })}
    </>
  );
}
