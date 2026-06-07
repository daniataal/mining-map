import { useCallback, useMemo, useState } from 'react';
import L from 'leaflet';
import { LayerGroup, LayersControl, useMap, Popup } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
import {
  formatStorageMapFeatureLabels,
  storageTankFarmsLayerShouldMount,
} from '../../lib/storageTankFarmsLayer';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import { isLiveDealClientClusterData } from '../../lib/liveDealMap/liveDealMapLod';
import { Button } from '../ui/button';

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
  onClusterSelect,
}: {
  features: LiveDealMapFeature[];
  mapZoom: number;
  selectedUid: string | null;
  onSelect: (item: MiningLicense) => void;
  onClusterSelect: (feature: LiveDealMapFeature) => void;
}) {
  const handleFeatureClick = useCallback(
    (feature: LiveDealMapFeature) => {
      if (
        feature.kind === 'server_cluster' &&
        isLiveDealClientClusterData(feature.data)
      ) {
        onClusterSelect(feature);
        return;
      }
      const item = feature.data as MiningLicense | undefined;
      if (item) onSelect(item);
    },
    [onClusterSelect, onSelect],
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

function ClusterPopup({
  cluster,
  onClose,
  allEntities,
}: {
  cluster: LiveDealMapFeature;
  onClose: () => void;
  allEntities: MiningLicense[];
}) {
  const map = useMap();
  const { t } = useI18n();
  if (!isLiveDealClientClusterData(cluster.data)) return null;

  const data = cluster.data;
  const count = data.count;
  const clusterIds = new Set(data.sourceIds);

  const items = allEntities.filter(e => clusterIds.has(e.id)).slice(0, 10);
  
  const handleZoom = () => {
    const { bounds } = data;
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
    onClose();
  };

  return (
    <Popup
      position={[cluster.lat, cluster.lng]}
      onClose={onClose}
      className="storage-cluster-popup"
      closeButton={true}
    >
      <div className="p-2 w-[240px]">
        <h3 className="font-bold mb-2 text-[13px] text-primary">{cluster.title}</h3>
        <div className="flex flex-col gap-1 mb-3">
          {items.map(item => (
             <div key={item.id} className="text-[11px] truncate">{item.name || item.id}</div>
          ))}
          {count > 10 && <div className="text-[11px] text-muted-foreground mt-1">+{count - 10} more...</div>}
        </div>
        <Button size="sm" className="w-full text-[12px] h-7 cursor-pointer" onClick={handleZoom}>
          {t('התקרב למיקומים', 'Zoom In')}
        </Button>
      </div>
    </Popup>
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
  const [selectedCluster, setSelectedCluster] = useState<LiveDealMapFeature | null>(null);

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
          onClusterSelect={setSelectedCluster}
        />
        {selectedCluster && (
          <ClusterPopup
            cluster={selectedCluster}
            onClose={() => setSelectedCluster(null)}
            allEntities={placemarks}
          />
        )}
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
