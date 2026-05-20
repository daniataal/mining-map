import { useMemo } from 'react';
import L from 'leaflet';
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet';
import type { PathOptions } from 'leaflet';
import {
  OsmPetroleumLayerId,
  defaultOsmLayerVisibility,
  useOsmPetroleumLayerGeoJson,
} from '../../lib/osmPetroleumLayers';
import type { PetroleumViewportBounds } from '../../lib/petroleumLayers';
import { isPetroleumMapboxDisabled, usePetroleumLayerCatalog } from '../../lib/petroleumLayers';
import { useI18n } from '../../lib/i18n';
import { bindPetroleumFeaturePopup } from './bindPetroleumPopup';
import { createRefineryMapIcon } from './refineryMapIcon';

const OSM_MAP_LAYER_IDS: OsmPetroleumLayerId[] = ['pipelines', 'refineries'];

const OSM_STYLE: Record<OsmPetroleumLayerId, PathOptions> = {
  pipelines: {
    color: '#64748b',
    weight: 2.5,
    opacity: 0.75,
    dashArray: '5 4',
    lineCap: 'round',
  },
  refineries: { color: '#c2410c', weight: 1, fillColor: '#fb923c', fillOpacity: 0.85 },
  storage_terminals: { color: '#06b6d4', weight: 1, fillColor: '#22d3ee', fillOpacity: 0.85 },
};

const OSM_LABELS: Record<'pipelines' | 'refineries', [string, string]> = {
  pipelines: ['צינורות OSM (קהילה)', 'Pipelines — OpenStreetMap (community)'],
  refineries: ['זיקוק OSM (קהילה)', 'Refineries — OpenStreetMap (community)'],
};

interface OsmLayerOverlayProps {
  layerId: 'pipelines' | 'refineries';
  label: string;
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
}

function OsmLayerOverlay({
  layerId,
  label,
  bbox,
  enabled,
  defaultVisible,
}: OsmLayerOverlayProps & { defaultVisible: boolean }) {
  const { data } = useOsmPetroleumLayerGeoJson(layerId, bbox, enabled);
  const style = OSM_STYLE[layerId];
  const geojson = useMemo(
    () => data ?? { type: 'FeatureCollection' as const, features: [] },
    [data],
  );
  const refineryIcon = useMemo(() => createRefineryMapIcon(false), []);
  const mapboxLayerId = layerId === 'refineries' ? 'refineries' : 'oil_pipelines';

  return (
    <LayersControl.Overlay checked={defaultVisible} name={label}>
      <LayerGroup>
        <GeoJSON
          key={`osm-${layerId}`}
          data={geojson}
          style={style}
          pointToLayer={(feature, latlng) => {
            if (layerId === 'refineries') {
              return L.marker(latlng, { icon: refineryIcon });
            }
            return L.circleMarker(latlng, { radius: 3, ...style });
          }}
          onEachFeature={(feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            bindPetroleumFeaturePopup(layer, mapboxLayerId, props, feature.geometry ?? null);
          }}
        />
      </LayerGroup>
    </LayersControl.Overlay>
  );
}

interface OsmPetroleumMapLayersProps {
  bbox: PetroleumViewportBounds | null;
  enabled: boolean;
}

export default function OsmPetroleumMapLayers({ bbox, enabled }: OsmPetroleumMapLayersProps) {
  const { t } = useI18n();
  const { data: catalog } = usePetroleumLayerCatalog(enabled);
  const mapboxOff = isPetroleumMapboxDisabled(catalog);
  const osmDefaults = defaultOsmLayerVisibility(mapboxOff);

  if (!enabled) return null;

  return (
    <>
      {OSM_MAP_LAYER_IDS.map((layerId) => (
        <OsmLayerOverlay
          key={layerId}
          layerId={layerId}
          label={t(OSM_LABELS[layerId][0], OSM_LABELS[layerId][1])}
          bbox={bbox}
          enabled={enabled}
          defaultVisible={osmDefaults[layerId]}
        />
      ))}
    </>
  );
}
