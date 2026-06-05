import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import {
  DEFAULT_PETROLEUM_LAYER_VISIBILITY,
  PetroleumLayerId,
  PetroleumViewportBounds,
  isPetroleumMapboxDisabled,
  usePetroleumLayerCatalog,
  usePetroleumLayerGeoJson,
} from '../../lib/petroleumLayers';
import { useI18n } from '../../lib/i18n';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import { shouldIncludeInOilGasPipelineLayer } from '../../lib/pipelineSubstance';

function layerStyle(layerId: PetroleumLayerId, isDark: boolean): PathOptions {
  switch (layerId) {
    case 'exploration':
      return { color: '#f59e0b', weight: 1.8, fillColor: '#fbbf24', fillOpacity: 0.28 };
    case 'production':
      return { color: '#059669', weight: 1.8, fillColor: '#34d399', fillOpacity: 0.24 };
    case 'bid_rounds':
      return { color: '#9333ea', weight: 1.6, fillColor: '#c084fc', fillOpacity: 0.22, dashArray: '4 3' };
    case 'refineries':
      return { color: '#ea580c', weight: 1, fillColor: '#fb923c', fillOpacity: 0.9 };
    case 'oil_pipelines':
      return {
        color: isDark ? '#fbbf24' : '#0f172a',
        weight: 3,
        opacity: isDark ? 0.92 : 0.88,
        lineCap: 'round',
        lineJoin: 'round',
      };
    case 'gas_pipelines':
      return {
        color: isDark ? '#38bdf8' : '#0284c7',
        weight: 2.6,
        opacity: 0.88,
        dashArray: isDark ? undefined : '6 4',
        lineCap: 'round',
      };
    default:
      return { color: '#64748b', weight: 2 };
  }
}

const LAYER_LABELS: Record<PetroleumLayerId, [string, string]> = {
  exploration: ['חקר', 'Exploration'],
  production: ['ייצור', 'Production'],
  bid_rounds: ['מכרזים', 'Bid rounds'],
  refineries: ['זיקוק', 'Refineries'],
  oil_pipelines: ['צינורות נפט', 'Oil pipelines'],
  gas_pipelines: ['צינורות גז', 'Gas pipelines'],
};

interface PetroleumLayerOverlayProps {
  layerId: PetroleumLayerId;
  label: string;
  bbox: PetroleumViewportBounds;
  mapZoom: number;
  enabled: boolean;
  isDark: boolean;
}

function PetroleumLayerOverlay({
  layerId,
  label,
  bbox,
  mapZoom,
  enabled,
  isDark,
}: PetroleumLayerOverlayProps) {
  const { data } = usePetroleumLayerGeoJson(layerId, bbox, enabled, mapZoom);
  const style = layerStyle(layerId, isDark);
  const geojson = useMemo(() => {
    const raw = data ?? { type: 'FeatureCollection' as const, features: [] };
    if (layerId !== 'oil_pipelines' && layerId !== 'gas_pipelines') {
      return raw;
    }
    return {
      ...raw,
      features: raw.features.filter((feature) => {
        const props = (feature.properties || {}) as Record<string, unknown>;
        return shouldIncludeInOilGasPipelineLayer(props, layerId);
      }),
    };
  }, [data, layerId]);
  const canvasRenderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  return (
    <LayersControl.Overlay checked={DEFAULT_PETROLEUM_LAYER_VISIBILITY[layerId]} name={label}>
      <LayerGroup>
        <GeoJSON
          key={layerId}
          data={geojson}
          style={style}
          renderer={canvasRenderer}
          pointToLayer={(feature, latlng) => {
            if (layerId === 'refineries') {
              return L.circleMarker(latlng, {
                renderer: canvasRenderer,
                radius: 5,
                ...style,
              });
            }
            return L.circleMarker(latlng, {
              renderer: canvasRenderer,
              radius: 4,
              ...style,
            });
          }}
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            bindPetroleumFeaturePopup(layer, layerId, props, feature.geometry ?? null);
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}

interface PetroleumMapLayersProps {
  bbox: PetroleumViewportBounds;
  mapZoom: number;
  enabled: boolean;
  isDark?: boolean;
}

export default function PetroleumMapLayers({
  bbox,
  mapZoom,
  enabled,
  isDark = true,
}: PetroleumMapLayersProps) {
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);

  if (!enabled) return null;

  if (mapboxOff) return null;

  return (
    <>
      {(Object.keys(LAYER_LABELS) as PetroleumLayerId[]).map((layerId) => (
        <PetroleumLayerOverlay
          key={layerId}
          layerId={layerId}
          label={t(LAYER_LABELS[layerId][0], LAYER_LABELS[layerId][1])}
          bbox={bbox}
          mapZoom={mapZoom}
          enabled={enabled}
          isDark={isDark}
        />
      ))}
    </>
  );
}
