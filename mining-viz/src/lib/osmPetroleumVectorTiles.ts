import type { OsmPetroleumLayerId, OsmPetroleumCatalog } from './osmPetroleumLayers';

export const OSM_MVT_SOURCE_LAYER = 'petroleum_osm';
export const OSM_MVT_TILE_URL_TEMPLATE = '/api/petroleum/osm-tiles/{layer_id}/{z}/{x}/{y}.pbf';

export type { OsmPetroleumCatalogLayer, OsmPetroleumCatalog } from './osmPetroleumLayers';

/** Build absolute tile URL for one petroleum OSM layer. */
export function osmPetroleumTileUrl(layerId: OsmPetroleumLayerId, origin = ''): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${OSM_MVT_TILE_URL_TEMPLATE.replace('{layer_id}', layerId)}`;
}

/** True when MapLibre MVT rendering should be used (env override or Go catalog with tile URLs). */
export function osmVectorTilesEnabled(catalog?: OsmPetroleumCatalog | null): boolean {
  const env = import.meta.env.VITE_OSM_VECTOR_TILES;
  if (env === '0' || env === 'false' || env === 'off') return false;
  const hasTileTemplate = catalog?.layers?.some((layer) => Boolean(layer.tile_url_template));
  if (env === '1' || env === 'true' || env === 'on') return hasTileTemplate !== false;
  return catalog?.render_mode === 'mvt' && Boolean(hasTileTemplate);
}

