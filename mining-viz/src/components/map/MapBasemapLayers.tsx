import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LayersControl, TileLayer, useMap } from 'react-leaflet';
import type { LayersControlEvent } from 'leaflet';
import { useI18n } from '../../lib/i18n';
import {
  BASEMAP_TILES,
  BasemapId,
  defaultBasemapForTheme,
} from '../../lib/mapBasemaps';

const BASEMAP_LABELS: Record<BasemapId, [string, string]> = {
  dark: ['כהה', 'Dark'],
  light: ['בהיר', 'Light'],
  satellite: ['לוויין', 'Satellite'],
  topographic: ['טופוגרפי', 'Topographic'],
};

const BASEMAP_ORDER: BasemapId[] = ['dark', 'light', 'satellite', 'topographic'];

interface BasemapChangeSyncProps {
  labelToId: Record<string, BasemapId>;
  onChange: (id: BasemapId) => void;
}

/** Keep React `checked` state aligned with Leaflet layer-control radio selection. */
function BasemapChangeSync({ labelToId, onChange }: BasemapChangeSyncProps) {
  const map = useMap();

  useEffect(() => {
    const onBaseLayerChange = (event: LayersControlEvent) => {
      const id = labelToId[event.name];
      if (id) onChange(id);
    };
    map.on('baselayerchange', onBaseLayerChange);
    return () => {
      map.off('baselayerchange', onBaseLayerChange);
    };
  }, [map, labelToId, onChange]);

  return null;
}

interface MapBasemapLayersProps {
  isDark: boolean;
  /** When theme toggles, reset to theme default unless user is on satellite/topographic. */
  resetOnThemeChange?: boolean;
  position?: 'bottomright' | 'bottomleft' | 'topright' | 'topleft';
  /** Subset of basemaps (Oil map omits topographic). */
  include?: BasemapId[];
  children?: ReactNode;
}

export default function MapBasemapLayers({
  isDark,
  resetOnThemeChange = true,
  position = 'bottomright',
  include = BASEMAP_ORDER,
  children,
}: MapBasemapLayersProps) {
  const { t } = useI18n();
  const themeDefault = defaultBasemapForTheme(isDark);

  const labels = useMemo(() => {
    const out = {} as Record<BasemapId, string>;
    for (const id of include) {
      const [he, en] = BASEMAP_LABELS[id];
      out[id] = t(he, en);
    }
    return out;
  }, [include, t]);

  const labelToId = useMemo(() => {
    const out: Record<string, BasemapId> = {};
    for (const id of include) {
      out[labels[id]] = id;
    }
    return out;
  }, [include, labels]);

  const [activeBasemap, setActiveBasemap] = useState<BasemapId>(themeDefault);

  useEffect(() => {
    if (!resetOnThemeChange) return;
    setActiveBasemap((prev) => {
      if (prev === 'satellite' || prev === 'topographic') return prev;
      return themeDefault;
    });
  }, [themeDefault, resetOnThemeChange]);

  const handleBasemapChange = useCallback((id: BasemapId) => {
    setActiveBasemap(id);
  }, []);

  return (
    <>
      <BasemapChangeSync labelToId={labelToId} onChange={handleBasemapChange} />
      <LayersControl position={position}>
        {include.map((id) => {
          const tile = BASEMAP_TILES[id];
          return (
            <LayersControl.BaseLayer
              key={id}
              checked={activeBasemap === id}
              name={labels[id]}
            >
              <TileLayer
                url={tile.url}
                attribution={tile.attribution}
                maxZoom={tile.maxZoom}
              />
            </LayersControl.BaseLayer>
          );
        })}
        {children}
      </LayersControl>
    </>
  );
}
