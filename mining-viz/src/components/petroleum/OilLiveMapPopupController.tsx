import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { LiveDealMapFeature } from '../../lib/liveDealMap/liveDealMapTypes';
import type { OilLiveEntityClickPayload } from './oilLiveEntityPayload';
import OilLiveMapPopupContent from './OilLiveMapPopupContent';

const OIL_LIVE_POPUP_OPTIONS: L.PopupOptions = {
  className: 'oil-live-leaflet-popup',
  minWidth: 200,
  maxWidth: 320,
  autoPan: false,
  autoClose: false,
  closeOnClick: false,
};

export type OilLivePopupSnapshot = {
  uid: string;
  latlng: L.LatLng;
  feature: LiveDealMapFeature;
};

export function liveDealFeatureToPopupSnapshot(feature: LiveDealMapFeature): OilLivePopupSnapshot {
  const latlng =
    feature.shape === 'point'
      ? L.latLng(feature.lat, feature.lng)
      : L.latLng(feature.popupLat, feature.popupLng);
  return { uid: feature.uid, latlng, feature };
}

type OilLiveMapPopupControllerProps = {
  snapshot: OilLivePopupSnapshot | null;
  onClose: () => void;
  onEntityClick?: (payload: OilLiveEntityClickPayload) => void;
};

/**
 * Imperative Leaflet popup + React portal (same pattern as LicenseMapPopupController).
 * Avoids react-leaflet <Popup> remount/flicker during live layer polling updates.
 */
export default function OilLiveMapPopupController({
  snapshot,
  onClose,
  onEntityClick,
}: OilLiveMapPopupControllerProps) {
  const map = useMap();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<L.Popup | null>(null);
  const onCloseRef = useRef(onClose);
  const closingFromParentRef = useRef(false);

  onCloseRef.current = onClose;

  useEffect(() => {
    const host = document.createElement('div');
    hostRef.current = host;
    const popup = L.popup(OIL_LIVE_POPUP_OPTIONS);
    popupRef.current = popup;

    const handleRemove = () => {
      if (closingFromParentRef.current) return;
      onCloseRef.current();
    };
    popup.on('remove', handleRemove);

    return () => {
      popup.off('remove', handleRemove);
      closingFromParentRef.current = true;
      if (popup.isOpen()) {
        map.closePopup(popup);
      }
      closingFromParentRef.current = false;
      popupRef.current = null;
      hostRef.current = null;
    };
  }, [map]);

  const openKey = snapshot
    ? `${snapshot.uid}:${snapshot.latlng.lat.toFixed(5)}:${snapshot.latlng.lng.toFixed(5)}`
    : '';

  const openPopup = useCallback(() => {
    const popup = popupRef.current;
    const host = hostRef.current;
    if (!snapshot || !popup || !host) return;

    if (!popup.isOpen()) {
      popup.setLatLng(snapshot.latlng).setContent(host).openOn(map);
      return;
    }
    const current = popup.getLatLng();
    if (
      Math.abs(current.lat - snapshot.latlng.lat) > 1e-6 ||
      Math.abs(current.lng - snapshot.latlng.lng) > 1e-6
    ) {
      popup.setLatLng(snapshot.latlng);
    }
  }, [map, snapshot]);

  useEffect(() => {
    const popup = popupRef.current;
    if (!openKey) {
      if (popup?.isOpen()) {
        closingFromParentRef.current = true;
        map.closePopup(popup);
        closingFromParentRef.current = false;
      }
      return;
    }
    openPopup();
  }, [map, openKey, openPopup]);

  if (!snapshot || !hostRef.current) {
    return null;
  }

  return createPortal(
    <OilLiveMapPopupContent key={snapshot.uid} feature={snapshot.feature} onEntityClick={onEntityClick} />,
    hostRef.current,
  );
}
