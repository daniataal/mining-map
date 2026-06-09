import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';
import type { OsmPetroleumCatalogLayer } from './osmPetroleumLayers';
import { OSM_MVT_SOURCE_LAYER } from './osmPetroleumVectorTiles';
import {
  oilGasPipelineMvtColors,
  osmCombinedPipelineMvtColor,
} from './petroleumLayerStyles';

export type OsmVectorVisibility = Record<OsmPetroleumLayerId, boolean>;

export type OsmVectorStyleOptions = {
  isDark?: boolean;
  splitOilGasPipelineLayers?: boolean;
};

/** Leaflet pane for OSM petroleum MVT — above basemap tiles, below license canvas. */
export const OSM_PETROLEUM_VECTOR_PANE = 'petroleumVectorPane';

const SOURCE_IDS: Record<OsmPetroleumLayerId, string> = {
  pipelines: 'osm-pipelines',
  refineries: 'osm-refineries',
  storage_terminals: 'osm-storage-terminals',
};

export const STYLE_LAYER_IDS = {
  pipelinesOilGas: 'osm-pipelines-oil-gas',
  pipelinesOilGasHit: 'osm-pipelines-oil-gas-hit',
  pipelinesWater: 'osm-pipelines-water',
  pipelinesWaterHit: 'osm-pipelines-water-hit',
  refineries: 'osm-refineries-circles',
  storage: 'osm-storage-circles',
} as const;

/** Wide invisible MVT layers are listed first for easier line hit-testing. */
export const OSM_VECTOR_CLICK_LAYERS = [
  STYLE_LAYER_IDS.pipelinesOilGasHit,
  STYLE_LAYER_IDS.pipelinesWaterHit,
  STYLE_LAYER_IDS.pipelinesOilGas,
  STYLE_LAYER_IDS.pipelinesWater,
  STYLE_LAYER_IDS.refineries,
  STYLE_LAYER_IDS.storage,
];

function visibility(on: boolean): 'visible' | 'none' {
  return on ? 'visible' : 'none';
}

function tileUrlForLayer(
  layerId: OsmPetroleumLayerId,
  catalogLayer: OsmPetroleumCatalogLayer | undefined,
  origin: string,
): string {
  const template =
    catalogLayer?.tile_url_template ??
    `/api/petroleum/osm-tiles/${layerId}/{z}/{x}/{y}.pbf`;
  const path = template.replace('{layer_id}', layerId);
  return `${origin.replace(/\/$/, '')}${path}`;
}

function sourceForLayer(
  layerId: OsmPetroleumLayerId,
  catalogLayer: OsmPetroleumCatalogLayer | undefined,
  origin: string,
) {
  return {
    type: 'vector' as const,
    tiles: [tileUrlForLayer(layerId, catalogLayer, origin)],
    minzoom: catalogLayer?.min_zoom ?? (layerId === 'pipelines' ? 4 : 0),
    maxzoom: 18,
  };
}

function pipelineLinePaint(options?: OsmVectorStyleOptions) {
  const split = Boolean(options?.splitOilGasPipelineLayers);
  const isDark = options?.isDark !== false;
  const colors = oilGasPipelineMvtColors(isDark);
  if (split) {
    return {
      'line-color': [
        'match',
        ['get', 'pipeline_substance'],
        'oil',
        colors.oil,
        'gas',
        colors.gas,
        colors.fallback,
      ],
      'line-width': 3,
      'line-opacity': isDark ? 0.92 : 0.88,
    };
  }
  return {
    'line-color': osmCombinedPipelineMvtColor(isDark),
    'line-width': 3,
    'line-opacity': isDark ? 0.9 : 0.85,
    'line-dasharray': [5, 4],
  };
}

/** MapLibre style: transparent background + petroleum OSM vector tile layers. */
export function buildOsmPetroleumVectorStyle(
  visibilityMap: OsmVectorVisibility,
  catalogLayers: OsmPetroleumCatalogLayer[] | undefined,
  origin: string,
  styleOptions?: OsmVectorStyleOptions,
): StyleSpecification {
  const byId = new Map(catalogLayers?.map((layer) => [layer.id, layer]));
  const pipelinePaint = pipelineLinePaint(styleOptions);

  return {
    version: 8,
    name: 'osm-petroleum',
    sources: {
      [SOURCE_IDS.pipelines]: sourceForLayer('pipelines', byId.get('pipelines'), origin),
      [SOURCE_IDS.refineries]: sourceForLayer('refineries', byId.get('refineries'), origin),
      [SOURCE_IDS.storage_terminals]: sourceForLayer(
        'storage_terminals',
        byId.get('storage_terminals'),
        origin,
      ),
    },
    layers: [
      {
        id: STYLE_LAYER_IDS.pipelinesOilGas,
        type: 'line',
        source: SOURCE_IDS.pipelines,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: {
          visibility: visibility(visibilityMap.pipelines),
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: ['!=', ['get', 'pipeline_substance'], 'water'],
        paint: pipelinePaint,
      },
      {
        id: STYLE_LAYER_IDS.pipelinesWater,
        type: 'line',
        source: SOURCE_IDS.pipelines,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: {
          visibility: visibility(visibilityMap.pipelines),
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: ['==', ['get', 'pipeline_substance'], 'water'],
        paint: {
          'line-color': '#0891b2',
          'line-width': 2.5,
          'line-opacity': 0.8,
          'line-dasharray': [2, 6],
        },
      },
      {
        id: STYLE_LAYER_IDS.storage,
        type: 'circle',
        source: SOURCE_IDS.storage_terminals,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: { visibility: visibility(visibilityMap.storage_terminals) },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.25, 7, 1.8, 10, 3.2, 12, 4.5],
          'circle-color': '#22d3ee',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 7, 0.38, 10, 0.55, 12, 0.68],
          'circle-stroke-color': '#0e7490',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 9, 0.8, 12, 1],
        },
      },
      {
        id: STYLE_LAYER_IDS.refineries,
        type: 'circle',
        source: SOURCE_IDS.refineries,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: { visibility: visibility(visibilityMap.refineries) },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.2, 7, 4, 10, 6, 12, 8],
          'circle-color': '#f97316',
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 7, 0.55, 10, 0.88, 12, 0.95],
          'circle-stroke-color': '#fed7aa',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 9, 1, 12, 1.6],
        },
      },
      {
        id: STYLE_LAYER_IDS.pipelinesOilGasHit,
        type: 'line',
        source: SOURCE_IDS.pipelines,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: {
          visibility: visibility(visibilityMap.pipelines),
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: ['!=', ['get', 'pipeline_substance'], 'water'],
        paint: {
          'line-color': '#000000',
          'line-width': 22,
          /** Fully transparent — 5% opacity stacked at junctions into visible black smudges. */
          'line-opacity': 0,
        },
      },
      {
        id: STYLE_LAYER_IDS.pipelinesWaterHit,
        type: 'line',
        source: SOURCE_IDS.pipelines,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: {
          visibility: visibility(visibilityMap.pipelines),
          'line-cap': 'round',
          'line-join': 'round',
        },
        filter: ['==', ['get', 'pipeline_substance'], 'water'],
        paint: {
          'line-color': '#000000',
          'line-width': 20,
          'line-opacity': 0,
        },
      },
    ],
  };
}

export function applyOsmVectorVisibility(
  map: MaplibreMap,
  visibilityMap: OsmVectorVisibility,
): void {
  const pairs: Array<[string, boolean]> = [
    [STYLE_LAYER_IDS.pipelinesOilGas, visibilityMap.pipelines],
    [STYLE_LAYER_IDS.pipelinesWater, visibilityMap.pipelines],
    [STYLE_LAYER_IDS.pipelinesOilGasHit, visibilityMap.pipelines],
    [STYLE_LAYER_IDS.pipelinesWaterHit, visibilityMap.pipelines],
    [STYLE_LAYER_IDS.refineries, visibilityMap.refineries],
    [STYLE_LAYER_IDS.storage, visibilityMap.storage_terminals],
  ];
  for (const [layerId, on] of pairs) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility(on));
    }
  }
}
