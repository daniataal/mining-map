import type { InfrastructureFeatureSelection } from '../features/infrastructure/InfrastructureFeatureDrawer';
import { isGemPipelineFeature } from './petroleumFeatureFields';

export type MapFeaturePopupPayload = {
  feature_key: string;
  asset_id?: string | null;
  popup_version?: number;
  title?: string;
  subtitle?: string;
  bol_tier?: string;
  geocode_tier?: string;
  sources?: unknown;
  fields?: Record<string, unknown>;
  limitations?: string[];
  built_at?: string;
};

function oilLiveBase(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

export function featureKeyFromSelection(
  selection: InfrastructureFeatureSelection,
): string | null {
  const props = selection.properties;
  if (isGemPipelineFeature(props)) {
    const segmentKey = String(props.segment_key ?? props.project_id ?? '').trim();
    if (segmentKey) return `gem:pipeline:${segmentKey}`;
  }
  const osmId = props.osm_id;
  const osmType = String(props.osm_type ?? '').trim();
  const layerId = String(props.layer_id ?? selection.layerId).trim();
  if (osmType && osmId != null && String(osmId).trim() !== '') {
    if (layerId === 'pipelines') {
      return `osm:pipelines:${osmType}:${osmId}`;
    }
    return `osm:${layerId}:${osmType}:${osmId}`;
  }
  const storageId = String(props.id ?? '').trim();
  if (selection.layerId === 'storage_terminals' && storageId) {
    return `storage:${storageId}`;
  }
  return null;
}

export async function fetchMapFeaturePopup(
  featureKey: string,
  signal?: AbortSignal,
): Promise<MapFeaturePopupPayload | null> {
  const key = encodeURIComponent(featureKey);
  const res = await fetch(`${oilLiveBase()}/api/oil-live/map/features/${key}/popup`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as MapFeaturePopupPayload;
}

export async function fetchMapFeaturePopupAt(
  lat: number,
  lng: number,
  layerId: string,
  signal?: AbortSignal,
  featureKey?: string | null,
): Promise<MapFeaturePopupPayload | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    layer_id: layerId,
  });
  if (featureKey) params.set('feature_key', featureKey);
  const res = await fetch(`${oilLiveBase()}/api/oil-live/map/features/popup-at?${params}`, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return (await res.json()) as MapFeaturePopupPayload;
}

/** Merge pre-materialized DB popup into live map selection properties. */
export function mergePopupPayloadIntoProperties(
  props: Record<string, unknown>,
  payload: MapFeaturePopupPayload,
): Record<string, unknown> {
  const fields = (payload.fields ?? {}) as Record<string, unknown>;
  const operator =
    fields.operator ??
    fields.operator_name ??
    fields.Operator ??
    props.operator ??
    props.operatorName;
  return {
    ...props,
    ...fields,
    name: payload.title ?? fields.name ?? props.name,
    pipeline_name: fields.pipeline_name ?? payload.title ?? props.pipeline_name,
    operator,
    operatorName: operator,
    data_tier: fields.data_tier ?? payload.bol_tier,
    geocode_tier: payload.geocode_tier ?? props.geocode_tier,
    popup_sources: payload.sources,
    popup_limitations: payload.limitations,
    materialized_popup: true,
    materialized_built_at: payload.built_at,
  };
}

export async function enrichSelectionWithMaterializedPopup(
  selection: InfrastructureFeatureSelection,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const key = featureKeyFromSelection(selection);
  const coords = selection.coordinates;
  let payload: MapFeaturePopupPayload | null = null;
  if (key) {
    payload = await fetchMapFeaturePopup(key, signal);
  }
  if (!payload && coords) {
    payload = await fetchMapFeaturePopupAt(
      coords.lat,
      coords.lng,
      selection.layerId,
      signal,
      key,
    );
  }
  if (!payload) return selection.properties;
  return mergePopupPayloadIntoProperties(selection.properties, payload);
}
