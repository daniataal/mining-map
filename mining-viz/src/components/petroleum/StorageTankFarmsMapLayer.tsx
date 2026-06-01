import { useMemo } from 'react';
import { LayerGroup, LayersControl } from 'react-leaflet';
import type { MiningLicense } from '../../types';
import { useI18n } from '../../lib/i18n';
import {
  storageTankFarmsLayerShouldMount,
} from '../../lib/storageTankFarmsLayer';
import CanvasLiveDealLayer from './CanvasLiveDealLayer';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';

interface StorageTankFarmsMapLayerProps {
  entities: MiningLicense[];
  enabled: boolean;
  mapZoom?: number;
  selectedId?: string | null;
  onSelect: (item: MiningLicense) => void;
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
      placemarks.map((item) => ({
        shape: 'point',
        uid: `storage:${item.id}`,
        id: item.id,
        kind: item.entitySubtype === 'tank_farm' ? 'tank_farm' : 'storage_terminal',
        lat: item.lat,
        lng: item.lng,
        title: item.company,
        subtitle: [item.operatorName, item.ownerName, item.country].filter(Boolean).join(' · '),
        tier: item.recordOrigin ?? item.sourceKind ?? 'inferred',
        confidence: item.confidenceScore ?? item.geoConfidence ?? undefined,
        sourceCount: item.sourceLabels?.length ?? item.evidenceCount ?? 0,
        dealScore: item.confidenceScore ?? 0.6,
        styleKey: item.entitySubtype ?? 'storage_terminal',
        data: item,
      })),
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
        <CanvasLiveDealLayer
          features={features}
          mapZoom={mapZoom ?? 5}
          selectedUid={selectedId ? `storage:${selectedId}` : null}
          onFeatureClick={(feature) => {
            const item = feature.data as MiningLicense | undefined;
            if (item) onSelect(item);
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
