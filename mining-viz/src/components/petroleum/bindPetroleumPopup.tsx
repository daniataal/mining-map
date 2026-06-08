import { createRoot, type Root } from 'react-dom/client';
import type { Layer, Map as LeafletMap, PopupOptions } from 'leaflet';
import L from 'leaflet';
import PetroleumFeaturePopup from './PetroleumFeaturePopup';
import type { PetroleumLayerId } from '../../lib/petroleumLayers';
import { I18nProvider } from '../../lib/i18n';
import { getFeatureCoordinates } from '../../lib/geojsonUtils';

const popupRoots = new WeakMap<Layer, Root>();

const MAP_POPUP_OPTIONS: PopupOptions = {
  className: 'petroleum-leaflet-popup',
  maxWidth: 380,
  minWidth: 320,
  autoPanPadding: [16, 16],
  autoClose: true,
  closeOnClick: false,
};

export type PetroleumMapPopupHandle = {
  close: () => void;
  updateProperties: (properties: Record<string, unknown>) => void;
};

/** Open a React petroleum popup at a map coordinate (MVT / map-level picks). */
export function openPetroleumFeaturePopupOnMap(
  map: LeafletMap,
  latlng: L.LatLngExpression,
  layerId: PetroleumLayerId,
  properties: Record<string, unknown>,
  coordinates?: { lat: number; lng: number } | null,
): PetroleumMapPopupHandle {
  const host = document.createElement('div');
  host.className = 'petroleum-map-popup-mount';
  const root = createRoot(host);
  const popup = L.popup(MAP_POPUP_OPTIONS);

  const render = (props: Record<string, unknown>) => {
    root.render(
      <I18nProvider>
        <PetroleumFeaturePopup
          layerId={layerId}
          properties={props}
          coordinates={coordinates}
        />
      </I18nProvider>,
    );
  };

  render(properties);
  popup.setLatLng(latlng).setContent(host).openOn(map);
  popup.on('remove', () => {
    root.unmount();
  });

  return {
    close: () => {
      if (popup.isOpen()) map.closePopup(popup);
    },
    updateProperties: (props) => render(props),
  };
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
