import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { LayersControlEvent } from 'leaflet';

interface MaritimeLayerSyncProps {
  layerName: string;
  onLayerActiveChange: (active: boolean) => void;
}

/** Sync React vessel-layer state with Leaflet overlay add/remove from the layer control. */
export default function MaritimeLayerSync({ layerName, onLayerActiveChange }: MaritimeLayerSyncProps) {
  const map = useMap();

  useEffect(() => {
    const onAdd = (event: LayersControlEvent) => {
      if (event.name === layerName) onLayerActiveChange(true);
    };
    const onRemove = (event: LayersControlEvent) => {
      if (event.name === layerName) onLayerActiveChange(false);
    };
    map.on('overlayadd', onAdd);
    map.on('overlayremove', onRemove);
    return () => {
      map.off('overlayadd', onAdd);
      map.off('overlayremove', onRemove);
    };
  }, [map, layerName, onLayerActiveChange]);

  return null;
}
