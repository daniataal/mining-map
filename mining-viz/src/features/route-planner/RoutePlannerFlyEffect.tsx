import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

interface RoutePlannerFlyEffectProps {
  target: { lat: number; lng: number } | null;
  trigger: number;
}

export default function RoutePlannerFlyEffect({ target, trigger }: RoutePlannerFlyEffectProps) {
  const map = useMap();

  useEffect(() => {
    if (!target || trigger <= 0) return;
    const currentZoom = map.getZoom();
    map.flyTo([target.lat, target.lng], Math.max(currentZoom, 6), { duration: 0.85 });
  }, [map, target, trigger]);

  return null;
}
