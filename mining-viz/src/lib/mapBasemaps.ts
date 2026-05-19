export type BasemapId = 'dark' | 'light' | 'satellite' | 'topographic';

export interface BasemapTileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

/** Leaflet tile templates for map base layers (no API keys required). */
export const BASEMAP_TILES: Record<BasemapId, BasemapTileConfig> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  /** Carto Voyager — stronger land/water contrast and readable labels vs Positron/light_all. */
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  satellite: {
    // ArcGIS MapServer uses {z}/{row}/{col} → Leaflet {z}/{y}/{x}
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  },
  topographic: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap (&copy; OpenStreetMap)',
    maxZoom: 17,
  },
};

export function defaultBasemapForTheme(isDark: boolean): BasemapId {
  return isDark ? 'dark' : 'light';
}
