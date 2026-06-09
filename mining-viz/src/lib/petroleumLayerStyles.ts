import type { PathOptions } from 'leaflet';

/** Shared oil/gas pipeline line colors for Leaflet GeoJSON and MapLibre MVT. */
export function oilGasPipelineLeafletStyle(
  layerId: 'oil_pipelines' | 'gas_pipelines',
  isDark: boolean,
): PathOptions {
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
    lineJoin: 'round',
  };
}

/** MapLibre line-color expression values for split oil/gas OSM pipelines. */
export function oilGasPipelineMvtColors(isDark: boolean): { oil: string; gas: string; fallback: string } {
  return {
    oil: isDark ? '#fbbf24' : '#b45309',
    gas: isDark ? '#38bdf8' : '#0284c7',
    fallback: isDark ? '#fbbf24' : '#b45309',
  };
}

export function osmCombinedPipelineMvtColor(isDark: boolean): string {
  return isDark ? '#fbbf24' : '#b45309';
}
