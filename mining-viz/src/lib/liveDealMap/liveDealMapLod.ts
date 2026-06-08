import type {
  LiveDealFeatureKind,
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
          : feature.kind === 'storage_tank'
            ? 200
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

function clientClusterGridDegreesForZoom(zoom: number): number {
  if (zoom < 7) return 1.1;
  if (zoom < 9) return 0.45;
  if (zoom < 11) return 0.12;
  if (zoom < 13) return 0.035;
  return 0;
}

export type LiveDealClientClusterData = {
  clientCluster: true;
  count: number;
  bounds: LiveDealViewport;
  sourceIds: string[];
  sourceUids: string[];
  clusterKind?: LiveDealFeatureKind;
};

export interface LiveDealPointFeatureDrawOptions {
  clusterPoints?: boolean;
  clusterKinds?: readonly LiveDealFeatureKind[];
  clusterMinCount?: number;
  clusterMaxZoom?: number;
  clusterGridMultiplier?: number;
}

export function isLiveDealClientClusterData(value: unknown): value is LiveDealClientClusterData {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as LiveDealClientClusterData).clientCluster === true,
  );
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

export function planLiveDealPointFeatureDraw(
  features: readonly LiveDealMapFeature[],
  viewport: LiveDealViewport,
  zoom: number,
  selectedUid?: string | null,
  options: LiveDealPointFeatureDrawOptions = {},
): { drawFeatures: LiveDealPointFeature[]; lodSubsampling: boolean } {
  const visible: number[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i];
    if (feature.shape === 'point' && pointInViewport(feature, viewport)) {
      visible.push(i);
    }
  }

  const clusterMaxZoom = options.clusterMaxZoom ?? 13;
  const gridMultiplier = Math.max(1, options.clusterGridMultiplier ?? 1);
  const clusterGrid = options.clusterPoints && zoom < clusterMaxZoom
    ? clientClusterGridDegreesForZoom(zoom) * gridMultiplier
    : 0;

  if (!options.clusterPoints || clusterGrid <= 0) {
    const plan = planLiveDealPointDraw(features, viewport, zoom, selectedUid);
    return {
      drawFeatures: plan.drawIndices
        .map((index) => features[index])
        .filter((feature): feature is LiveDealPointFeature => feature?.shape === 'point'),
      lodSubsampling: plan.lodSubsampling,
    };
  }

  const clusterKinds = new Set(options.clusterKinds ?? ['license']);
  const minCount = Math.max(2, options.clusterMinCount ?? 2);
  const selectedIndex = selectedUid
    ? features.findIndex((feature) => feature.uid === selectedUid)
    : -1;
  const passthrough: number[] = [];
  const groups = new Map<string, number[]>();

  for (const index of visible) {
    const feature = features[index] as LiveDealPointFeature;
    if (!clusterKinds.has(feature.kind)) {
      passthrough.push(index);
      continue;
    }
    const key = `${Math.floor(feature.lat / clusterGrid)}:${Math.floor(feature.lng / clusterGrid)}:${feature.kind}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  }

  const drawFeatures: LiveDealPointFeature[] = passthrough.map((index) => features[index] as LiveDealPointFeature);
  let clustered = false;

  for (const indices of groups.values()) {
    const first = features[indices[0]] as LiveDealPointFeature;
    const forceLicenseCluster =
      first.kind === 'license' && zoom < 8 && clusterKinds.has('license');

    if (indices.length < minCount && !forceLicenseCluster) {
      drawFeatures.push(...indices.map((index) => features[index] as LiveDealPointFeature));
      continue;
    }
    clustered = true;
    let latSum = 0;
    let lngSum = 0;
    let maxConfidence = 0;
    let maxDealScore = 0;
    let sourceCount = 0;
    let south = Number.POSITIVE_INFINITY;
    let west = Number.POSITIVE_INFINITY;
    let north = Number.NEGATIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    const sourceIds: string[] = [];
    const sourceUids: string[] = [];

    for (const index of indices) {
      const feature = features[index] as LiveDealPointFeature;
      latSum += feature.lat;
      lngSum += feature.lng;
      maxConfidence = Math.max(maxConfidence, feature.confidence ?? 0);
      maxDealScore = Math.max(maxDealScore, feature.dealScore ?? 0);
      sourceCount += feature.sourceCount ?? 0;
      south = Math.min(south, feature.lat);
      west = Math.min(west, feature.lng);
      north = Math.max(north, feature.lat);
      east = Math.max(east, feature.lng);
      if (sourceIds.length < 100) sourceIds.push(feature.id);
      if (sourceUids.length < 100) sourceUids.push(feature.uid);
    }

    const count = indices.length;
    drawFeatures.push({
      shape: 'point',
      uid: `client-cluster:${first.kind}:${Math.round(zoom * 10) / 10}:${sourceUids.slice(0, 6).join(':')}:${count}`,
      id: `client-cluster:${first.kind}:${sourceIds.slice(0, 6).join(':')}:${count}`,
      kind: 'server_cluster',
      lat: latSum / count,
      lng: lngSum / count,
      title: `${count} ${first.kind === 'license' ? 'licenses' : 'items'}`,
      subtitle: 'Zoom in for individual records',
      tier: 'aggregate',
      confidence: maxConfidence || undefined,
      sourceCount: count,
      dealScore: maxDealScore || undefined,
      styleKey: 'client_cluster',
      data: {
        clientCluster: true,
        count,
        bounds: { south, west, north, east },
        sourceIds,
        sourceUids,
        clusterKind: first.kind,
      } satisfies LiveDealClientClusterData,
    });
  }

  if (selectedIndex >= 0 && features[selectedIndex]?.shape === 'point') {
    const selected = features[selectedIndex] as LiveDealPointFeature;
    if (!drawFeatures.some((feature) => feature.uid === selected.uid)) {
      drawFeatures.push(selected);
    }
  }

  const cap = liveDealPointCapForZoom(zoom);
  if (Number.isFinite(cap) && drawFeatures.length > cap) {
    const selected = selectedUid
      ? drawFeatures.find((feature) => feature.uid === selectedUid)
      : undefined;
    const trimmed = [...drawFeatures]
      .sort((a, b) => liveDealFeaturePriority(b) - liveDealFeaturePriority(a))
      .slice(0, cap);
    if (selected && !trimmed.some((feature) => feature.uid === selected.uid)) {
      trimmed.push(selected);
    }
    return { drawFeatures: trimmed, lodSubsampling: true };
  }

  return { drawFeatures, lodSubsampling: clustered || visible.length !== drawFeatures.length };
}

/** Max zoom when drilling canvas aggregate bubbles (storage, licenses). */
export const LIVE_DEAL_CLIENT_CLUSTER_EXPAND_ZOOM = 15;

export function targetZoomForLiveDealClientCluster(
  boundsFitZoom: number | null,
): number {
  const fitZoom = boundsFitZoom ?? 0;
  return Math.min(18, Math.max(LIVE_DEAL_CLIENT_CLUSTER_EXPAND_ZOOM, fitZoom + 1));
}
