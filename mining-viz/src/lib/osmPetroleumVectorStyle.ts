import type { Map as MaplibreMap, StyleSpecification } from 'maplibre-gl';
import type { OsmPetroleumLayerId } from './osmPetroleumLayers';
import type { OsmPetroleumCatalogLayer } from './osmPetroleumLayers';
import { OSM_MVT_SOURCE_LAYER } from './osmPetroleumVectorTiles';

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
  pipelinesWater: 'osm-pipelines-water',
  refineries: 'osm-refineries-circles',
  storage: 'osm-storage-circles',
} as const;

export const OSM_VECTOR_CLICK_LAYERS = [
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
    maxzoom: 14,
  };
}

function pipelineLinePaint(options?: OsmVectorStyleOptions) {
  const split = Boolean(options?.splitOilGasPipelineLayers);
  const isDark = options?.isDark !== false;
  if (split) {
    return {
      'line-color': [
        'match',
        ['get', 'pipeline_substance'],
        'oil',
        isDark ? '#fbbf24' : '#b45309',
        'gas',
        isDark ? '#38bdf8' : '#0284c7',
        isDark ? '#fbbf24' : '#b45309',
      ],
      'line-width': 3,
      'line-opacity': isDark ? 0.92 : 0.88,
    };
  }
  return {
    'line-color': isDark ? '#fbbf24' : '#b45309',
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
        id: STYLE_LAYER_IDS.refineries,
        type: 'circle',
        source: SOURCE_IDS.refineries,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: { visibility: visibility(visibilityMap.refineries) },
        paint: {
          'circle-radius': 6,
          'circle-color': '#fb923c',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#c2410c',
          'circle-stroke-width': 1,
        },
      },
      {
        id: STYLE_LAYER_IDS.storage,
        type: 'circle',
        source: SOURCE_IDS.storage_terminals,
        'source-layer': OSM_MVT_SOURCE_LAYER,
        layout: { visibility: visibility(visibilityMap.storage_terminals) },
        paint: {
          'circle-radius': 4,
          'circle-color': '#22d3ee',
          'circle-opacity': 0.85,
          'circle-stroke-color': '#06b6d4',
          'circle-stroke-width': 1,
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
    [STYLE_LAYER_IDS.refineries, visibilityMap.refineries],
    [STYLE_LAYER_IDS.storage, visibilityMap.storage_terminals],
  ];
  for (const [layerId, on] of pairs) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility(on));
    }
  }
}
