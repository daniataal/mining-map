import { useMemo } from 'react';
import { CircleMarker, LayerGroup, LayersControl } from 'react-leaflet';
import type { Layer } from 'leaflet';
import { useI18n } from '../../lib/i18n';
import { gemPlantMarkerStyle, useGemPlantGeoJson } from '../../lib/gemPlants';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';

interface GemGogptPlantMapLayerProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
  mapZoom?: number;
  isDark?: boolean;
}

function pointCoords(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry || geometry.type !== 'Point') return null;
  const [lng, lat] = geometry.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

export default function GemGogptPlantMapLayer({
  bbox,
  enabled,
  mapZoom: _mapZoom,
  isDark = true,
}: GemGogptPlantMapLayerProps) {
  const { t } = useI18n();
  const { data } = useGemPlantGeoJson(bbox, enabled, _mapZoom);
  const features = useMemo(() => data?.features ?? [], [data]);

  if (!enabled) return null;

  const layerLabel = t(
    'מתקני GEM GOGPT (גז/נפט)',
    'Plants — GEM GOGPT (power/CHP)',
  );

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        {features.map((feature) => {
          const coords = pointCoords(feature.geometry ?? undefined);
          if (!coords) return null;
          const props = (feature.properties || {}) as Record<string, unknown>;
          const style = gemPlantMarkerStyle(
            String(props.fuel || ''),
            String(props.status || ''),
            isDark,
          );
          const key = String(feature.id ?? props.unit_key ?? coords.join(','));
          return (
            <CircleMarker
              key={key}
              center={coords}
              pathOptions={style}
              eventHandlers={{
                add: (e) => {
                  bindPetroleumFeaturePopup(
                    e.target as Layer,
                    'refineries',
                    props,
                    feature.geometry ?? null,
                  );
                },
              }}
            />
          );
        })}
      </LayerGroup>
    </LayersControl.Overlay>
  );
}
