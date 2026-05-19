import { describe, expect, it } from 'vitest';
import { BASEMAP_TILES, defaultBasemapForTheme } from './mapBasemaps';

describe('mapBasemaps', () => {
  it('defaults to dark Carto and light Voyager basemaps', () => {
    expect(defaultBasemapForTheme(true)).toBe('dark');
    expect(defaultBasemapForTheme(false)).toBe('light');
    expect(BASEMAP_TILES.dark.url).toContain('dark_all');
    expect(BASEMAP_TILES.light.url).toContain('voyager');
  });
});
