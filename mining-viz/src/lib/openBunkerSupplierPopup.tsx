import { createRoot, type Root } from 'react-dom/client';
import type { Map as LeafletMap, PopupOptions } from 'leaflet';
import L from 'leaflet';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from './i18n';
import { queryClient } from './queryClient';
import type { NearbySupplier } from './nearbySuppliers';
import BunkerSupplierPopupContent from '../components/popup/BunkerSupplierPopupContent';
import { markMapPerf, measureMapPerf } from './mapPerfBudget';

const BUNKER_POPUP_OPTIONS: PopupOptions = {
  className: 'petroleum-leaflet-popup custom-popup--storage',
  maxWidth: 360,
  minWidth: 300,
  autoPanPadding: [16, 16],
  autoClose: true,
  closeOnClick: false,
};

export type BunkerSupplierPopupHandle = {
  close: () => void;
};

export function openBunkerSupplierPopup(
  map: LeafletMap,
  lat: number,
  lng: number,
  supplier: NearbySupplier,
  handlers?: {
    onOpenDossier?: () => void;
    onViewInRegistry?: () => void;
  },
): BunkerSupplierPopupHandle {
  markMapPerf('bunker-popup-open');
  const host = document.createElement('div');
  host.className = 'petroleum-map-popup-mount';
  const root: Root = createRoot(host);
  const popup = L.popup(BUNKER_POPUP_OPTIONS);
  let mounted = true;

  const render = () => {
    if (!mounted) return;
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <BunkerSupplierPopupContent
            supplier={supplier}
            onOpenDossier={handlers?.onOpenDossier}
            onViewInRegistry={handlers?.onViewInRegistry}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
  };

  render();
  queueMicrotask(() => measureMapPerf('bunker-popup-interactive', 'map:bunker-popup-open'));
  popup.setLatLng([lat, lng]).setContent(host).openOn(map);
  popup.on('remove', () => {
    mounted = false;
    queueMicrotask(() => root.unmount());
  });

  return {
    close: () => {
      mounted = false;
      if (popup.isOpen()) map.closePopup(popup);
    },
  };
}
