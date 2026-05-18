import { createRoot, type Root } from 'react-dom/client';
import type { Layer, PopupOptions } from 'leaflet';
import PetroleumFeaturePopup from './PetroleumFeaturePopup';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';
import { I18nProvider } from '../../lib/i18n';

const popupRoots = new WeakMap<Layer, Root>();

function getFeatureCoordinates(
  geometry: GeoJSON.Geometry | null | undefined
): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }
  if (geometry.type === 'MultiPoint' && geometry.coordinates.length > 0) {
    const [lng, lat] = geometry.coordinates[0] as [number, number];
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

/** Mount a React popup on a Leaflet layer (GeoJSON feature, circle marker, etc.). */
export function bindPetroleumFeaturePopup(
  layer: Layer,
  layerId: PetroleumLayerId,
  properties: Record<string, unknown>,
  geometry?: GeoJSON.Geometry | null,
  popupOptions?: PopupOptions
): void {
  const coordinates = getFeatureCoordinates(geometry);

  layer.bindPopup(
    () => {
      const container = document.createElement('div');
      container.className = 'petroleum-map-popup-mount';
      const root = createRoot(container);
      popupRoots.set(layer, root);
      root.render(
        <I18nProvider>
          <PetroleumFeaturePopup
            layerId={layerId}
            properties={properties}
            coordinates={coordinates}
          />
        </I18nProvider>
      );
      return container;
    },
    {
      className: 'petroleum-leaflet-popup',
      maxWidth: 380,
      minWidth: 320,
      autoPanPadding: [16, 16],
      ...popupOptions,
    }
  );

  layer.on('popupclose', () => {
    const root = popupRoots.get(layer);
    if (root) {
      root.unmount();
      popupRoots.delete(layer);
    }
  });
}
