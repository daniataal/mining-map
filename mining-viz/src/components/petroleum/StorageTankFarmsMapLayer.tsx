import { useCallback, useMemo } from 'react';
import L from 'leaflet';
import { LayerGroup, LayersControl, useMap } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
import {
  formatStorageMapFeatureLabels,
  storageTankFarmsLayerShouldMount,
} from '../../lib/storageTankFarmsLayer';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import { isLiveDealClientClusterData } from '../../lib/liveDealMap/liveDealMapLod';

const STORAGE_CANVAS_CLUSTER_KINDS = ['storage_terminal', 'tank_farm', 'storage_tank'] as const;
const STORAGE_CANVAS_CLUSTER_MAX_ZOOM = 14;
const STORAGE_CANVAS_CLUSTER_MIN_COUNT = 2;

interface StorageTankFarmsMapLayerProps {
  entities: MiningLicense[];
  enabled: boolean;
  mapZoom?: number;
  selectedId?: string | null;
  onSelect: (item: MiningLicense) => void;
}

function StorageTankFarmsCanvas({
  features,
  mapZoom,
  selectedUid,
  onSelect,
}: {
  features: LiveDealMapFeature[];
  mapZoom: number;
  selectedUid: string | null;
  onSelect: (item: MiningLicense) => void;
}) {
  const map = useMap();

  const handleFeatureClick = useCallback(
    (feature: LiveDealMapFeature) => {
      if (
        feature.kind === 'server_cluster' &&
        isLiveDealClientClusterData(feature.data)
      ) {
        const { bounds } = feature.data;
        const leafletBounds = L.latLngBounds(
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        );
        map.stop();
        map.flyToBounds(leafletBounds.pad(0.12), {
          maxZoom: STORAGE_CANVAS_CLUSTER_MAX_ZOOM + 1,
          padding: [36, 36],
          duration: 0.5,
        });
        return;
      }
      const item = feature.data as MiningLicense | undefined;
      if (item) onSelect(item);
    },
    [map, onSelect],
  );

  return (
    <CanvasLiveDealLayer
      features={features}
      mapZoom={mapZoom}
      selectedUid={selectedUid}
      onFeatureClick={handleFeatureClick}
      clusterPoints
      clusterKinds={STORAGE_CANVAS_CLUSTER_KINDS}
      clusterMaxZoom={STORAGE_CANVAS_CLUSTER_MAX_ZOOM}
      clusterMinCount={STORAGE_CANVAS_CLUSTER_MIN_COUNT}
    />
  );
}

export default function StorageTankFarmsMapLayer({
  entities,
  enabled,
  mapZoom,
  selectedId,
  onSelect,
}: StorageTankFarmsMapLayerProps) {
  const { t } = useI18n();
  const placemarks = useMemo(
    () =>
      entities.filter(
        (item): item is MiningLicense & { lat: number; lng: number } =>
          item.lat != null && item.lng != null,
      ),
    [entities],
  );
  const features = useMemo<LiveDealMapFeature[]>(
    () =>
      placemarks.map((item) => {
        const labels = formatStorageMapFeatureLabels(item);
        return {
        shape: 'point',
        uid: `storage:${item.id}`,
        id: item.id,
        kind:
          item.entitySubtype === 'tank_farm'
            ? 'tank_farm'
            : item.entitySubtype === 'storage_tank'
              ? 'storage_tank'
              : 'storage_terminal',
        lat: item.lat,
        lng: item.lng,
        title: labels.title,
        subtitle: labels.subtitle ?? undefined,
        tier: item.recordOrigin ?? item.sourceKind ?? 'inferred',
        confidence: item.confidenceScore ?? item.geoConfidence ?? undefined,
        sourceCount: item.sourceLabels?.length ?? item.evidenceCount ?? 0,
        dealScore: item.confidenceScore ?? 0.6,
        styleKey: item.entitySubtype ?? 'storage_terminal',
        data: item,
      };
      }),
    [placemarks],
  );

  if (!storageTankFarmsLayerShouldMount(enabled, mapZoom)) return null;

  // #region agent log
  fetch('http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7419a2' },
    body: JSON.stringify({
      sessionId: '7419a2',
      hypothesisId: 'C',
      location: 'StorageTankFarmsMapLayer.tsx:render',
      message: 'storage_layer_render',
      data: {
        enabled,
        entityCount: entities.length,
        placemarkCount: placemarks.length,
        featureCount: features.length,
        mapZoom: mapZoom ?? null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const layerLabel = t(
    'מסופי אחסון / טנקים (OSM + מקורות)',
    'Storage / tank farms (OSM + reference)',
  );

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        <StorageTankFarmsCanvas
          features={features}
          mapZoom={mapZoom ?? 5}
          selectedUid={selectedId ? `storage:${selectedId}` : null}
          onSelect={onSelect}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
