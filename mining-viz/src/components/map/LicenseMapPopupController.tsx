import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { I18nProvider } from '../../lib/i18n';
import { isServerLicenseCluster } from '../../lib/licenseMapCluster';
import { isSidebarFlySelection } from '../../lib/licensePopupOpenDelay';
import { getEsgZoneIntersection } from '../../lib/esgConservationZones';
import type { LicenseMarkerClusterGroup } from '../../lib/markerClusterTypes';
import type { MiningLicense, UserAnnotation } from '../../types';
import PopupForm from '../PopupForm';

const LICENSE_POPUP_OPTIONS: L.PopupOptions = {
  className: 'custom-popup custom-popup--license',
  minWidth: 360,
  maxWidth: 380,
  autoPan: true,
  autoClose: false,
  closeOnClick: false,
};

export type LicenseMapPopupControllerProps = {
  selectedItem: MiningLicense | null;
  mapFlyTrigger: number;
  markerRefs: React.MutableRefObject<Record<string, L.Marker>>;
  clusterGroupRef: React.MutableRefObject<LicenseMarkerClusterGroup | null>;
  preferCoordinatePopup?: boolean;
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  deleteLicense: (id: string) => void;
  handleOpenDossier: (item: MiningLicense) => void;
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
  getDealRoomForLicense?: (id: string, entityKind?: string) => { title: string } | null | undefined;
};

function licensePopupItemSignature(item: MiningLicense): string {
  return [
    item.id,
    item.company,
    item.phoneNumber ?? '',
    item.status ?? '',
    item.country ?? '',
    item.commodity ?? '',
    item._displayLat ?? item.lat ?? '',
    item._displayLng ?? item.lng ?? '',
    item.entityKind ?? '',
  ].join('|');
}

/**
 * One Leaflet popup + one React portal for the selected license. Avoids mounting
 * PopupForm on every marker and avoids createRoot re-renders that flash action buttons.
 */
export default function LicenseMapPopupController({
  selectedItem,
  mapFlyTrigger,
  markerRefs,
  clusterGroupRef,
  preferCoordinatePopup = false,
  userAnnotations,
  updateAnnotation,
  deleteLicense,
  handleOpenDossier,
  isInDdQueue,
  onAddToDueDiligence,
  onRemoveFromDueDiligence,
  getDealRoomForLicense,
}: LicenseMapPopupControllerProps) {
  const map = useMap();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<L.Popup | null>(null);
  const prevFlyTriggerRef = useRef(mapFlyTrigger);
  const selectedItemRef = useRef<MiningLicense | null>(null);
  const propsRef = useRef({
    updateAnnotation,
    deleteLicense,
    handleOpenDossier,
    isInDdQueue,
    onAddToDueDiligence,
    onRemoveFromDueDiligence,
    getDealRoomForLicense,
  });

  propsRef.current = {
    updateAnnotation,
    deleteLicense,
    handleOpenDossier,
    isInDdQueue,
    onAddToDueDiligence,
    onRemoveFromDueDiligence,
    getDealRoomForLicense,
  };

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  useEffect(() => {
    const host = document.createElement('div');
    hostRef.current = host;
    popupRef.current = L.popup(LICENSE_POPUP_OPTIONS);
    return () => {
      const popup = popupRef.current;
      if (popup?.isOpen()) {
        map.closePopup(popup);
      }
      popupRef.current = null;
      hostRef.current = null;
    };
  }, [map]);

  const popupItem = useMemo(() => {
    if (!selectedItem || isServerLicenseCluster(selectedItem)) return null;
    return selectedItem;
  }, [selectedItem, selectedItem ? licensePopupItemSignature(selectedItem) : '']);

  const lat = popupItem?._displayLat ?? popupItem?.lat;
  const lng = popupItem?._displayLng ?? popupItem?.lng;
  const openPositionKey =
    popupItem && lat != null && lng != null ? `${popupItem.id}:${lat}:${lng}` : '';

  const openPopupAt = useCallback(
    (forceCoordinate: boolean) => {
      const item = selectedItemRef.current;
      const popup = popupRef.current;
      const host = hostRef.current;
      if (!item || !popup || !host || isServerLicenseCluster(item)) return;

      const itemLat = item._displayLat ?? item.lat;
      const itemLng = item._displayLng ?? item.lng;
      if (itemLat == null || itemLng == null) return;

      const marker = markerRefs.current[item.id];
      const latlng =
        forceCoordinate || preferCoordinatePopup
          ? L.latLng(itemLat, itemLng)
          : (marker?.getLatLng?.() ?? L.latLng(itemLat, itemLng));

      if (!popup.isOpen()) {
        popup.setLatLng(latlng).setContent(host).openOn(map);
        return;
      }
      const current = popup.getLatLng();
      if (
        Math.abs(current.lat - latlng.lat) > 1e-6 ||
        Math.abs(current.lng - latlng.lng) > 1e-6
      ) {
        popup.setLatLng(latlng);
      }
    },
    [map, markerRefs, preferCoordinatePopup],
  );

  useEffect(() => {
    const popup = popupRef.current;
    if (!openPositionKey) {
      if (popup?.isOpen()) map.closePopup(popup);
      return;
    }
    openPopupAt(preferCoordinatePopup);
  }, [map, openPositionKey, openPopupAt, preferCoordinatePopup]);

  useEffect(() => {
    const prevFly = prevFlyTriggerRef.current;
    prevFlyTriggerRef.current = mapFlyTrigger;

    if (!popupItem) return;

    const sidebarFly = isSidebarFlySelection(mapFlyTrigger, prevFly);
    let cancelled = false;
    let moveendHandler: (() => void) | null = null;
    let spiderfyHandler: (() => void) | null = null;
    let raf = 0;

    const finishOpen = () => {
      if (cancelled) return;
      if (preferCoordinatePopup) {
        openPopupAt(true);
        return;
      }
      const attemptOpen = (triesLeft: number) => {
        if (cancelled) return;
        const item = selectedItemRef.current;
        const hasCoords =
          item != null &&
          (item._displayLat ?? item.lat) != null &&
          (item._displayLng ?? item.lng) != null;
        const hasMarker = item != null && Boolean(markerRefs.current[item.id]);
        if (hasCoords && (hasMarker || triesLeft <= 0)) {
          openPopupAt(false);
          return;
        }
        if (triesLeft > 0) {
          raf = requestAnimationFrame(() => attemptOpen(triesLeft - 1));
        }
      };
      raf = requestAnimationFrame(() => attemptOpen(2));
    };

    if (sidebarFly) {
      moveendHandler = finishOpen;
      map.once('moveend', moveendHandler);
    } else {
      const cluster = clusterGroupRef.current;
      if (cluster && !preferCoordinatePopup) {
        spiderfyHandler = finishOpen;
        cluster.once('spiderfied', spiderfyHandler);
      }
      if (!popupRef.current?.isOpen()) {
        finishOpen();
      }
    }

    return () => {
      cancelled = true;
      if (moveendHandler) map.off('moveend', moveendHandler);
      if (spiderfyHandler && clusterGroupRef.current) {
        clusterGroupRef.current.off('spiderfied', spiderfyHandler);
      }
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    popupItem?.id,
    mapFlyTrigger,
    map,
    clusterGroupRef,
    openPopupAt,
    preferCoordinatePopup,
  ]);

  useEffect(() => {
    if (!popupItem) return;
    const marker = markerRefs.current[popupItem.id];
    if (!marker) return;

    const onMove = () => {
      const popup = popupRef.current;
      if (!popup?.isOpen()) return;
      popup.setLatLng(marker.getLatLng());
    };

    marker.on('move', onMove);
    return () => {
      marker.off('move', onMove);
    };
  }, [popupItem?.id, markerRefs]);

  const annotation = popupItem ? userAnnotations[popupItem.id] ?? {} : {};

  const isInQueue = popupItem ? (isInDdQueue?.(popupItem.id) ?? false) : false;
  const dealRoomTitle = popupItem
    ? getDealRoomForLicense?.(popupItem.id, popupItem.entityKind || 'license')?.title
    : undefined;

  const latForEsg = popupItem?._displayLat ?? popupItem?.lat;
  const lngForEsg = popupItem?._displayLng ?? popupItem?.lng;
  const esgZone =
    latForEsg != null && lngForEsg != null
      ? getEsgZoneIntersection(latForEsg, lngForEsg)
      : null;

  const onDeleteStable = useCallback(() => {
    const id = selectedItemRef.current?.id;
    if (id) propsRef.current.deleteLicense(id);
  }, []);

  const onOpenDossierStable = useCallback(() => {
    const item = selectedItemRef.current;
    if (item) propsRef.current.handleOpenDossier(item);
  }, []);

  const onAddDdStable = useCallback(() => {
    const id = selectedItemRef.current?.id;
    if (id) propsRef.current.onAddToDueDiligence?.(id);
  }, []);

  const onRemoveDdStable = useCallback(() => {
    const id = selectedItemRef.current?.id;
    if (id) propsRef.current.onRemoveFromDueDiligence?.(id);
  }, []);

  const updateAnnotationStable = useCallback((id: string, updates: Partial<UserAnnotation>) => {
    propsRef.current.updateAnnotation(id, updates);
  }, []);

  if (!popupItem || !hostRef.current) {
    return null;
  }

  return createPortal(
    <I18nProvider>
      <PopupForm
        key={popupItem.id}
        item={popupItem}
        annotation={annotation}
        updateAnnotation={updateAnnotationStable}
        onDelete={onDeleteStable}
        onOpenDossier={onOpenDossierStable}
        isInDdQueue={isInQueue}
        onAddToDueDiligence={
          onAddToDueDiligence ? onAddDdStable : undefined
        }
        onRemoveFromDueDiligence={
          onRemoveFromDueDiligence ? onRemoveDdStable : undefined
        }
        isEsgRisk={esgZone !== null}
        esgZoneName={esgZone?.name}
        dealRoomTitle={dealRoomTitle}
      />
    </I18nProvider>,
    hostRef.current,
  );
}
