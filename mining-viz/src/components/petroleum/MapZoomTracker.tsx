import { useCallback, useEffect } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

export default function MapZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  const emit = useCallback(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);

  useMapEvents({
    zoomend: emit,
  });

  useEffect(() => {
    emit();
  }, [emit]);

  return null;
}
