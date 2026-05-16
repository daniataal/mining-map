import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import {
  DEFAULT_PETROLEUM_LAYER_VISIBILITY,
  PetroleumLayerId,
  PetroleumViewportBounds,
  usePetroleumLayerCatalog,
  usePetroleumLayerGeoJson,
} from '../../lib/petroleumLayers';
import { useI18n } from '../../lib/i18n';

const LAYER_STYLE: Record<PetroleumLayerId, PathOptions> = {
  exploration: { color: '#f59e0b', weight: 1.5, fillColor: '#f59e0b', fillOpacity: 0.22 },
  production: { color: '#10b981', weight: 1.5, fillColor: '#10b981', fillOpacity: 0.2 },
  bid_rounds: { color: '#a855f7', weight: 1.5, fillColor: '#a855f7', fillOpacity: 0.18 },
  refineries: { color: '#fb923c', weight: 1, fillColor: '#fb923c', fillOpacity: 0.85 },
  oil_pipelines: { color: '#1e293b', weight: 2.2, opacity: 0.85 },
  gas_pipelines: { color: '#0ea5e9', weight: 2, opacity: 0.8 },
};

const LAYER_LABELS: Record<PetroleumLayerId, [string, string]> = {
  exploration: ['חקר', 'Exploration'],
  production: ['ייצור', 'Production'],
  bid_rounds: ['מכרזים', 'Bid rounds'],
  refineries: ['זיקוק', 'Refineries'],
  oil_pipelines: ['צינורות נפט', 'Oil pipelines'],
  gas_pipelines: ['צינורות גז', 'Gas pipelines'],
};

function featurePopupHtml(properties: Record<string, unknown>): string {
  const rows: string[] = [];
  const pick = (key: string, label: string) => {
    const value = properties[key];
    if (value == null || value === '') return;
    rows.push(`<dt>${label}</dt><dd>${String(value)}</dd>`);
  };
  pick('Name', 'Name');
  pick('title', 'Title');
  pick('Company', 'Company');
  pick('Country', 'Country');
  pick('Type', 'Type');
  pick('STATUS', 'Status');
  pick('NAME', 'Name');
  pick('description', 'Description');
  pick('link', 'Link');
  pick('Source', 'Source');
  pick('SOURCE', 'Source');
  if (!rows.length) return '<p class="text-[9px] text-slate-400">No attributes</p>';
  return `<dl class="text-[9px] leading-snug">${rows.join('')}</dl>`;
}

interface PetroleumLayerOverlayProps {
  layerId: PetroleumLayerId;
  label: string;
  bbox: PetroleumViewportBounds | null;
  mapZoom: number;
  enabled: boolean;
}

function PetroleumLayerOverlay({ layerId, label, bbox, mapZoom, enabled }: PetroleumLayerOverlayProps) {
  const { data } = usePetroleumLayerGeoJson(layerId, bbox, enabled, mapZoom);
  const style = LAYER_STYLE[layerId];
  const geojson = useMemo(() => data ?? { type: 'FeatureCollection' as const, features: [] }, [data]);

  return (
    <LayersControl.Overlay checked={DEFAULT_PETROLEUM_LAYER_VISIBILITY[layerId]} name={label}>
      <LayerGroup>
        <GeoJSON
          key={`${layerId}:${data?.feature_count ?? 0}:${data?.zoom ?? mapZoom}`}
          data={geojson}
          style={style}
          pointToLayer={(_feature, latlng) =>
            L.circleMarker(latlng, {
              radius: layerId === 'refineries' ? 5 : 4,
              ...style,
            })
          }
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            layer.bindPopup(featurePopupHtml(props), { maxWidth: 280 });
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}

interface PetroleumMapLayersProps {
  bbox: PetroleumViewportBounds | null;
  mapZoom: number;
  enabled: boolean;
}

export default function PetroleumMapLayers({ bbox, mapZoom, enabled }: PetroleumMapLayersProps) {
  const { t } = useI18n();
  usePetroleumLayerCatalog(enabled);

  if (!enabled) return null;

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
        />
      ))}
    </>
  );
}
