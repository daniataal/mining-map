import { useCallback, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  userAnnotations: Record<string, UserAnnotation>;
  updateAnnotation: (id: string, updates: Partial<UserAnnotation>) => void;
  deleteLicense: (id: string) => void;
  handleOpenDossier: (item: MiningLicense) => void;
  isInDdQueue?: (id: string) => boolean;
  onAddToDueDiligence?: (id: string) => void;
  onRemoveFromDueDiligence?: (id: string) => void;
  getDealRoomForLicense?: (id: string, entityKind?: string) => { title: string } | null | undefined;
};

/**
 * One Leaflet popup + one React root for the selected license. Avoids mounting
 * PopupForm on every marker (slow) and prevents close/reopen when selection changes.
 */
export default function LicenseMapPopupController({
  selectedItem,
  mapFlyTrigger,
  markerRefs,
  clusterGroupRef,
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const popupRef = useRef<L.Popup | null>(null);
  const prevFlyTriggerRef = useRef(mapFlyTrigger);
  const selectedIdRef = useRef<string | null>(null);
  const selectedItemRef = useRef<MiningLicense | null>(null);

  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const ensureContainer = useCallback(() => {
    if (!containerRef.current) {
      containerRef.current = document.createElement('motion.div');
      rootRef.current = createRoot(containerRef.current);
    }
    return containerRef.current;
  }, []);

  const ensurePopup = useCallback(() => {
    if (!popupRef.current) {
      popupRef.current = L.popup(LICENSE_POPUP_OPTIONS);
    }
    return popupRef.current;
  }, []);

  const renderPopupContent = useCallback(
    (item: MiningLicense) => {
      if (!rootRef.current) return;
      const annotation = userAnnotations[item.id] || {};
      const lat = item._displayLat ?? item.lat;
      const lng = item._displayLng ?? item.lng;
      const esgZone = lat != null && lng != null ? getEsgZoneIntersection(lat, lng) : null;
      const isEsgRisk = esgZone !== null;

      rootRef.current.render(
        <I18nProvider>
          <PopupForm
            item={item}
            annotation={annotation}
            updateAnnotation={updateAnnotation}
            onDelete={() => deleteLicense(item.id)}
            onOpenDossier={() => handleOpenDossier(item)}
            isInDdQueue={isInDdQueue?.(item.id) ?? false}
            onAddToDueDiligence={
              onAddToDueDiligence ? () => onAddToDueDiligence(item.id) : undefined
            }
            onRemoveFromDueDiligence={
              onRemoveFromDueDiligence ? () => onRemoveFromDueDiligence(item.id) : undefined
            }
            isEsgRisk={isEsgRisk}
            esgZoneName={esgZone?.name}
            dealRoomTitle={
              getDealRoomForLicense?.(item.id, item.entityKind || 'license')?.title
            }
          />
        </I18nProvider>,
      );
    },
    [
      userAnnotations,
      updateAnnotation,
      deleteLicense,
      handleOpenDossier,
      isInDdQueue,
      onAddToDueDiligence,
      onRemoveFromDueDiligence,
      getDealRoomForLicense,
    ],
  );

  const openAtSelectedMarker = useCallback(() => {
    const item = selectedItemRef.current;
    if (!item) return;

    const lat = item._displayLat ?? item.lat;
    const lng = item._displayLng ?? item.lng;
    if (lat == null || lng == null) return;

    const container = ensureContainer();
    const popup = ensurePopup();
    const marker = markerRefs.current[item.id];
    const latlng = marker?.getLatLng?.() ?? L.latLng(lat, lng);

    if (popup.isOpen()) {
      popup.setLatLng(latlng);
      popup.update();
      return;
    }

    popup.setLatLng(latlng).setContent(container).openOn(map);
  }, [ensureContainer, ensurePopup, map, markerRefs]);

  // Keep popup body in sync while open (DD queue, deal room, annotations).
  useEffect(() => {
    if (!selectedItem) return;
    ensureContainer();
    renderPopupContent(selectedItem);
    if (popupRef.current?.isOpen()) {
      popupRef.current.update();
    }
  }, [selectedItem, renderPopupContent, ensureContainer, userAnnotations]);

  // Open / reposition when selection or fly trigger changes.
  useEffect(() => {
    const prevFly = prevFlyTriggerRef.current;
    prevFlyTriggerRef.current = mapFlyTrigger;

    if (!selectedItem) {
      selectedIdRef.current = null;
      if (popupRef.current?.isOpen()) {
        map.closePopup(popupRef.current);
      }
      return;
    }

    if (isServerLicenseCluster(selectedItem)) {
      selectedIdRef.current = null;
      if (popupRef.current?.isOpen()) {
        map.closePopup(popupRef.current);
      }
      return;
    }

    selectedIdRef.current = selectedItem.id;
    ensureContainer();
    renderPopupContent(selectedItem);

    const sidebarFly = isSidebarFlySelection(mapFlyTrigger, prevFly);
    let cancelled = false;
    let moveendHandler: (() => void) | null = null;
    let spiderfyHandler: (() => void) | null = null;
    let raf1 = 0;
    let raf2 = 0;

    const finishOpen = () => {
      if (cancelled) return;
      const attemptOpen = (triesLeft: number) => {
        if (cancelled) return;
        const item = selectedItemRef.current;
        const hasCoords =
          item != null &&
          (item._displayLat ?? item.lat) != null &&
          (item._displayLng ?? item.lng) != null;
        const hasMarker = item != null && Boolean(markerRefs.current[item.id]);
        if (hasCoords && (hasMarker || triesLeft <= 0)) {
          openAtSelectedMarker();
          return;
        }
        if (triesLeft > 0) {
          raf1 = requestAnimationFrame(() => attemptOpen(triesLeft - 1));
        }
      };
      raf1 = requestAnimationFrame(() => attemptOpen(8));
    };

    if (sidebarFly) {
      moveendHandler = finishOpen;
      map.once('moveend', moveendHandler);
    } else {
      const cluster = clusterGroupRef.current;
      if (cluster) {
        spiderfyHandler = finishOpen;
        cluster.once('spiderfied', spiderfyHandler);
      }
      finishOpen();
    }

    return () => {
      cancelled = true;
      if (moveendHandler) map.off('moveend', moveendHandler);
      if (spiderfyHandler && clusterGroupRef.current) {
        clusterGroupRef.current.off('spiderfied', spiderfyHandler);
      }
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [
    selectedItem?.id,
    mapFlyTrigger,
    map,
    clusterGroupRef,
    ensureContainer,
    renderPopupContent,
    openAtSelectedMarker,
  ]);

  // Follow spiderfied marker position without tearing down the popup.
  useEffect(() => {
    if (!selectedItem) return;
    const marker = markerRefs.current[selectedItem.id];
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
  }, [selectedItem?.id, markerRefs]);

  return null;
}
