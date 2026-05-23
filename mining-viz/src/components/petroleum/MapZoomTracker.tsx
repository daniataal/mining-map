import { useCallback, useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

export default function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const emit = useCallback(() => {
    onZoomChangeRef.current(map.getZoom());
  }, [map]);

  useMapEvents({
    zoomend: emit,
  });

  useEffect(() => {
    emit();
  }, [emit]);

  return null;
}
