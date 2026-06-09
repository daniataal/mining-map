/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import type { GeoJSONFeature, Map as MaplibreMap } from 'maplibre-gl';
import {
  type LeafletMapClickEvent,
  featureSelectionFromMvt,
  infrastructureSelectionUsesPopup,
  pickInfrastructureAtClick,
  pickNearestPointFeature,
  pickTopOsmMvtFeature,
  pointSelectionFromPick,
  queryOsmFeaturesAtPoint,
  selectionFromInfrastructurePick,
} from './infrastructureMapInteraction';
import { STYLE_LAYER_IDS } from './osmPetroleumVectorStyle';

function leafletEvent(lat: number, lng: number, clientX = 100, clientY = 200): LeafletMapClickEvent {
  return {
    latlng: { lat, lng },
    originalEvent: { clientX, clientY } as MouseEvent,
  };
}

describe('infrastructureMapInteraction', () => {
  it('prefers refinery point over pipeline line in MVT pick', () => {
    const features = [
      {
        layer: { id: STYLE_LAYER_IDS.pipelinesOilGas },
        properties: { layer_id: 'pipelines', name: 'Line' },
      },
      {
        layer: { id: STYLE_LAYER_IDS.refineries },
        properties: { layer_id: 'refineries', name: 'Refinery A' },
      },
    ] as GeoJSONFeature[];

    const top = pickTopOsmMvtFeature(features);
    expect(top?.layer.id).toBe(STYLE_LAYER_IDS.refineries);
    expect((top?.properties as Record<string, unknown>)?.name).toBe('Refinery A');
  });

  it('builds drawer selection from MVT properties', () => {
    const selection = featureSelectionFromMvt(
      { layer_id: 'refineries', name: 'Ras Tanura', osm_id: 1, osm_type: 'node' },
      { lat: 26.5, lng: 50.1 },
    );
    expect(selection.layerId).toBe('refineries');
    expect(selection.popupLayerId).toBe('refineries');
    expect(selection.coordinates).toEqual({ lat: 26.5, lng: 50.1 });
    expect(selection.properties.name).toBe('Ras Tanura');
  });

  it('prefers GEM pipeline geom over MVT OSM pipeline at the same click', () => {
    const mvtMap = {
      loaded: () => true,
      getLayer: (id: string) => (id ? {} : undefined),
      queryRenderedFeatures: vi.fn(() => [
        {
          layer: { id: STYLE_LAYER_IDS.pipelinesOilGas },
          properties: { layer_id: 'pipelines', name: 'OSM MVT pipe' },
        },
      ]),
      getContainer: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      }),
    } as unknown as MaplibreMap;

    const pipelineFeatures: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          name: 'Trans-Arabian',
          fuel_group: 'oil',
          layer_id: 'gem_pipelines',
          source: 'gem_goit_oil_ngl_pipelines_march_2025',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [41.6, 38.0],
            [41.7, 38.1],
          ],
        },
      },
    ];

    const pick = pickInfrastructureAtClick({
      mvtMap,
      leafletEvent: leafletEvent(38.05, 41.65),
      mvtMode: true,
      pipelineFeatures,
      refineryFeatures: [],
      storageFeatures: [],
      mapZoom: 7,
      loadPipelines: true,
      loadRefineries: false,
      loadStorage: false,
    });

    expect(pick?.kind).toBe('pipeline');
    expect((pick as { pick: { feature: GeoJSON.Feature } }).pick.feature.properties?.name).toBe(
      'Trans-Arabian',
    );
  });

  it('falls back to pipeline geom pick when MVT query returns nothing', () => {
    const mvtMap = {
      loaded: () => true,
      getLayer: () => ({}),
      queryRenderedFeatures: vi.fn(() => []),
      getContainer: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      }),
    } as unknown as MaplibreMap;

    const pipelineFeatures: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { name: 'Near pipe', pipeline_substance: 'oil' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      },
    ];

    const pick = pickInfrastructureAtClick({
      mvtMap,
      leafletEvent: leafletEvent(0, 0.5),
      mvtMode: true,
      pipelineFeatures,
      refineryFeatures: [],
      storageFeatures: [],
      mapZoom: 10,
      loadPipelines: true,
      loadRefineries: false,
      loadStorage: false,
    });

    expect(pick?.kind).toBe('pipeline');
    const selection = selectionFromInfrastructurePick(pick!, { lat: 0, lng: 0.5 });
    expect(selection.layerId).toBe('pipelines');
    expect(selection.properties.name).toBe('Near pipe');
  });

  it('picks nearest refinery point in GeoJSON fallback mode', () => {
    const refineryFeatures: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { name: 'Close refinery', layer_id: 'refineries' },
        geometry: { type: 'Point', coordinates: [0.001, 0.001] },
      },
      {
        type: 'Feature',
        properties: { name: 'Far refinery', layer_id: 'refineries' },
        geometry: { type: 'Point', coordinates: [10, 10] },
      },
    ];

    const pick = pickNearestPointFeature(refineryFeatures, 0, 0, 5000, 'refineries');
    expect(pick?.feature.properties?.name).toBe('Close refinery');

    const selection = pointSelectionFromPick(pick!);
    expect(selection.layerId).toBe('refineries');
    expect(selection.popupLayerId).toBe('refineries');
  });

  it('queries MVT features within padded box', () => {
    const queried = vi.fn(() => [
      {
        layer: { id: STYLE_LAYER_IDS.pipelinesOilGasHit },
        properties: { layer_id: 'pipelines' },
      },
    ]);
    const map = {
      queryRenderedFeatures: queried,
    } as unknown as MaplibreMap;

    const hits = queryOsmFeaturesAtPoint(map, { x: 50, y: 60 }, [STYLE_LAYER_IDS.pipelinesOilGasHit]);
    expect(hits).toHaveLength(1);
    expect(queried).toHaveBeenCalledWith(
      [
        [26, 36],
        [74, 84],
      ],
      { layers: [STYLE_LAYER_IDS.pipelinesOilGasHit] },
    );
  });

  it('routes refineries and storage to popup UX instead of the drawer', () => {
    expect(
      infrastructureSelectionUsesPopup({
        layerId: 'refineries',
        popupLayerId: 'refineries',
        properties: {},
        geometry: null,
        coordinates: null,
      }),
    ).toBe(true);
    expect(
      infrastructureSelectionUsesPopup({
        layerId: 'storage_terminals',
        popupLayerId: 'refineries',
        properties: {},
        geometry: null,
        coordinates: null,
      }),
    ).toBe(true);
    expect(
      infrastructureSelectionUsesPopup({
        layerId: 'pipelines',
        popupLayerId: 'oil_pipelines',
        properties: {},
        geometry: null,
        coordinates: null,
      }),
    ).toBe(false);
  });
});
