import { gemFuelGroupToPopupLayerId, gemPipelineStyle } from './gemPipelineMapStyle';
import type { LiveDealLatLng, LiveDealMapFeature } from './liveDealMap/liveDealMapTypes';

function linePositions(geometry: GeoJSON.Geometry | null | undefined): LiveDealLatLng[] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') {
    return (geometry.coordinates as [number, number][])
      .filter(([lng, lat]) => Number.isFinite(lat) && Number.isFinite(lng))
      .map(([lng, lat]) => [lat, lng] as LiveDealLatLng);
  }
  if (geometry.type === 'MultiLineString') {
    const out: LiveDealLatLng[] = [];
    for (const line of geometry.coordinates as [number, number][][]) {
      for (const [lng, lat] of line) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
      }
    }
    return out;
  }
  return [];
}

/** GEM pipeline segments as always-visible canvas polylines (pointer-events stay on map interaction layer). */
export function gemPipelineFeaturesToCanvas(
  features: GeoJSON.Feature[],
  isDark = true,
): LiveDealMapFeature[] {
  const out: LiveDealMapFeature[] = [];
  for (let idx = 0; idx < features.length; idx += 1) {
    const feature = features[idx];
    const positions = linePositions(feature.geometry ?? undefined);
    if (positions.length < 2) continue;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const fuel = String(props.fuel_group || '');
    const status = String(props.status || '');
    const style = gemPipelineStyle(fuel, status, isDark);
    const mid = positions[Math.floor(positions.length / 2)];
    const title = String(
      props.pipeline_name || props.name || props.segment_name || props.project_id || 'Pipeline',
    ).trim();
    out.push({
      shape: 'polyline',
      uid: `gem-pipeline:${String(feature.id ?? props.segment_key ?? idx)}`,
      id: String(feature.id ?? props.segment_key ?? idx),
      kind: 'infrastructure',
      positions,
      popupLat: mid[0],
      popupLng: mid[1],
      title,
      subtitle: [props.capacity_text, props.status].filter(Boolean).join(' · ') || undefined,
      tier: 'inferred',
      confidence: 0.85,
      sourceCount: 1,
      dealScore: 0.5,
      styleKey: gemFuelGroupToPopupLayerId(fuel),
      color: typeof style.color === 'string' ? style.color : '#fbbf24',
      weight: typeof style.weight === 'number' ? style.weight + 1 : 4,
      opacity: typeof style.opacity === 'number' ? Math.min(1, style.opacity + 0.05) : 0.95,
      dashArray: typeof style.dashArray === 'string' ? style.dashArray : undefined,
      data: props,
    });
  }
  return out;
}
