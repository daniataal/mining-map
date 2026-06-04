import { useMemo } from 'react';
import { CircleMarker, LayerGroup, LayersControl } from 'react-leaflet';
import type { Layer } from 'leaflet';
import { useI18n } from '../../lib/i18n';
import { gemLngMarkerStyle, useGemLngGeoJson } from '../../lib/gemLngTerminals';
import type { PetroleumViewportBounds } from '../../lib/petroleumViewportBounds';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';

interface GemGgitLngMapLayerProps {
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

export default function GemGgitLngMapLayer({
  bbox,
  enabled,
  mapZoom,
  isDark = true,
}: GemGgitLngMapLayerProps) {
  const { t } = useI18n();
  const { data } = useGemLngGeoJson(bbox, enabled, mapZoom);
  const features = useMemo(() => data?.features ?? [], [data]);

  if (!enabled) return null;

  const layerLabel = t('טרמינלים GEM GGIT (LNG)', 'LNG terminals — GEM GGIT');

  return (
    <LayersControl.Overlay checked name={layerLabel}>
      <LayerGroup>
        {features.map((feature) => {
          const coords = pointCoords(feature.geometry ?? undefined);
          if (!coords) return null;
          const props = (feature.properties || {}) as Record<string, unknown>;
          const style = gemLngMarkerStyle(
            String(props.terminal_type || ''),
            String(props.status || ''),
            isDark,
          );
          const key = String(feature.id ?? props.terminal_key ?? coords.join(','));
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
