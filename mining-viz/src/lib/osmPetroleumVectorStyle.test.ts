import { describe, expect, it } from 'vitest';
import { buildOsmPetroleumVectorStyle, applyOsmVectorVisibility } from './osmPetroleumVectorStyle';
import { osmPetroleumTileUrl, osmVectorTilesEnabled } from './osmPetroleumVectorTiles';

describe('osmPetroleumVectorTiles', () => {
  it('builds tile url for layer', () => {
    expect(osmPetroleumTileUrl('pipelines', 'http://localhost:5173')).toBe(
      'http://localhost:5173/api/petroleum/osm-tiles/pipelines/{z}/{x}/{y}.pbf',
    );
  });

  it('enables vector mode only when Go catalog exposes tile templates', () => {
    expect(
      osmVectorTilesEnabled({
        render_mode: 'mvt',
        layers: [{ id: 'pipelines', tile_url_template: '/api/petroleum/osm-tiles/{layer_id}/{z}/{x}/{y}.pbf' }],
      }),
    ).toBe(true);
    expect(osmVectorTilesEnabled({ render_mode: 'mvt', layers: [] })).toBe(false);
    expect(osmVectorTilesEnabled({ render_mode: 'geojson', layers: [] })).toBe(false);
  });
});

describe('osmPetroleumVectorStyle', () => {
  it('builds style with petroleum_osm source layer', () => {
    const style = buildOsmPetroleumVectorStyle(
      { pipelines: true, refineries: false, storage_terminals: false },
      [{ id: 'pipelines', min_zoom: 4, tile_url_template: '/api/petroleum/osm-tiles/{layer_id}/{z}/{x}/{y}.pbf' }],
      'http://localhost:5173',
    );
    expect(style.sources['osm-pipelines']).toBeDefined();
    expect(style.layers?.some((layer) => layer.id === 'osm-pipelines-oil-gas')).toBe(true);
  });

  it('applyOsmVectorVisibility is safe when map has no layers', () => {
    const fakeMap = {
      getLayer: () => undefined,
      setLayoutProperty: () => {},
    };
    expect(() =>
      applyOsmVectorVisibility(fakeMap as never, {
        pipelines: true,
        refineries: true,
        storage_terminals: true,
      }),
    ).not.toThrow();
  });
});
