import { useCallback, useEffect, useRef } from 'react';
import type L from 'leaflet';

const SELECTED_CLASS = 'is-selected';

type UseMarkerSelectionVisualArgs = {
  markerRefs: React.MutableRefObject<Record<string, L.Marker>>;
  selectedItemId: string | null;
};

export function useMarkerSelectionVisual({
  markerRefs,
  selectedItemId,
}: UseMarkerSelectionVisualArgs) {
  const prevSelectedIdRef = useRef<string | null>(null);

  const setMarkerSelectedVisual = useCallback((marker: L.Marker | undefined, selected: boolean) => {
    const el = marker?.getElement();
    if (!el) return;
    el.classList.toggle(SELECTED_CLASS, selected);
    const pin = el.querySelector('.refinery-marker-pin, .oil-field-marker-pin');
    if (pin) pin.classList.toggle('is-selected', selected);
  }, []);

  // Selection highlight only — popup open/close is handled by LicenseMapPopupController.
  useEffect(() => {
    const prevId = prevSelectedIdRef.current;
    if (prevId && prevId !== selectedItemId) {
      setMarkerSelectedVisual(markerRefs.current[prevId], false);
    }

    if (!selectedItemId) {
      prevSelectedIdRef.current = null;
      return;
    }

    setMarkerSelectedVisual(markerRefs.current[selectedItemId], true);
    prevSelectedIdRef.current = selectedItemId;
  }, [selectedItemId, markerRefs, setMarkerSelectedVisual]);
}
