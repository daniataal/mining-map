import type {
  LiveDealMapFeature,
  LiveDealPointFeature,
  LiveDealViewport,
} from './liveDealMapTypes';

function pointInViewport(feature: LiveDealPointFeature, viewport: LiveDealViewport): boolean {
  return (
    feature.lat >= viewport.south &&
    feature.lat <= viewport.north &&
    feature.lng >= viewport.west &&
    feature.lng <= viewport.east
  );
}

export function liveDealFeaturePriority(feature: LiveDealPointFeature): number {
  const dealScore = feature.dealScore ?? 0;
  const confidence = feature.confidence ?? 0;
  const kindWeight =
    feature.kind === 'opportunity'
      ? 500
      : feature.kind === 'server_cluster'
        ? 480
      : feature.kind === 'terminal'
        ? 400
        : feature.kind === 'storage_terminal' || feature.kind === 'tank_farm'
          ? 380
          : feature.kind === 'refinery' || feature.kind === 'oil_field'
            ? 360
        : feature.kind === 'cargo'
          ? 320
          : feature.kind === 'license'
            ? 300
          : feature.kind === 'vessel'
            ? 260
            : 100;
  return kindWeight + dealScore * 80 + confidence * 30 + (feature.sourceCount ?? 0);
}

export function liveDealPointCapForZoom(zoom: number): number {
  if (zoom < 5) return 180;
  if (zoom < 7) return 260;
  if (zoom < 9) return 420;
  return Number.POSITIVE_INFINITY;
}

function gridDegreesForZoom(zoom: number): number {
  if (zoom < 5) return 3.5;
  if (zoom < 7) return 1.75;
  if (zoom < 9) return 0.85;
  return 0.25;
}

export function planLiveDealPointDraw(
  features: readonly LiveDealMapFeature[],
  viewport: LiveDealViewport,
  zoom: number,
  selectedUid?: string | null,
): { drawIndices: number[]; lodSubsampling: boolean } {
  const visible: number[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i];
    if (feature.shape === 'point' && pointInViewport(feature, viewport)) {
      visible.push(i);
    }
  }

  const cap = liveDealPointCapForZoom(zoom);
  if (visible.length <= cap) {
    return { drawIndices: visible, lodSubsampling: false };
  }

  const cell = gridDegreesForZoom(zoom);
  const byCell = new Map<string, number>();
  for (const index of visible) {
    const feature = features[index] as LiveDealPointFeature;
    const key = `${Math.floor(feature.lat / cell)}:${Math.floor(feature.lng / cell)}`;
    const existing = byCell.get(key);
    if (existing == null) {
      byCell.set(key, index);
      continue;
    }
    const prev = features[existing] as LiveDealPointFeature;
    if (liveDealFeaturePriority(feature) > liveDealFeaturePriority(prev)) {
      byCell.set(key, index);
    }
  }

  const draw = [...byCell.values()].sort((a, b) => a - b).slice(0, cap);
  if (selectedUid) {
    const selected = features.findIndex((feature) => feature.uid === selectedUid);
    if (selected >= 0 && !draw.includes(selected)) draw.push(selected);
  }
  return { drawIndices: draw, lodSubsampling: true };
}
