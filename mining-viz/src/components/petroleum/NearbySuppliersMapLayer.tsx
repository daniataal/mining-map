import { useCallback, useRef } from 'react';
import { CircleMarker, LayerGroup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { PathOptions } from 'leaflet';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import { markMapFeatureClickHandled } from '../../lib/mapInteractionController';
import { openBunkerSupplierPopup } from '../../lib/openBunkerSupplierPopup';

/** SVG renderer — MapContainer preferCanvas breaks CircleMarker hit testing. */
const bunkerPointRenderer = L.svg({ padding: 0.5 });

type Props = {
  suppliers: NearbySupplier[];
  enabled?: boolean;
  selectedSupplierId?: string | null;
  onOpenDossier?: (supplier: NearbySupplier) => void;
  onViewInRegistry?: (supplier: NearbySupplier) => void;
  onSupplierSelect?: (supplier: NearbySupplier) => void;
};

function markerStyle(tier?: string): PathOptions {
  switch (tier) {
    case 'register_address_geocoded':
      return { color: '#22d3ee', fillColor: '#0891b2', fillOpacity: 0.85, weight: 2, radius: 7 };
    case 'osm_facility_match':
      return { color: '#fbbf24', fillColor: '#d97706', fillOpacity: 0.8, weight: 2, dashArray: '4 3', radius: 6 };
    case 'port_hub_anchor':
      return { color: '#94a3b8', fillColor: '#64748b', fillOpacity: 0.65, weight: 1.5, dashArray: '2 4', radius: 5 };
    default:
      return { color: '#64748b', fillColor: '#475569', fillOpacity: 0.5, weight: 1, radius: 4 };
  }
}

export default function NearbySuppliersMapLayer({
  suppliers,
  enabled = true,
  selectedSupplierId,
  onOpenDossier,
  onViewInRegistry,
  onSupplierSelect,
}: Props) {
  const map = useMap();
  const popupRef = useRef<ReturnType<typeof openBunkerSupplierPopup> | null>(null);

  const handleSupplierClick = useCallback(
    (supplier: NearbySupplier, e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      markMapFeatureClickHandled(e);
      onSupplierSelect?.(supplier);
      popupRef.current?.close();
      const lat = supplier.lat as number;
      const lng = supplier.lng as number;
      popupRef.current = openBunkerSupplierPopup(map, lat, lng, supplier, {
        onOpenDossier: onOpenDossier ? () => onOpenDossier(supplier) : undefined,
        onViewInRegistry: onViewInRegistry ? () => onViewInRegistry(supplier) : undefined,
      });
    },
    [map, onOpenDossier, onViewInRegistry, onSupplierSelect],
  );

  if (!enabled) return null;

  const mappable = suppliers.filter((s) => s.lat != null && s.lng != null);
  if (mappable.length === 0) return null;

  return (
    <LayerGroup>
      {mappable.map((supplier) => (
        <CircleMarker
          key={supplier.id}
          center={[supplier.lat as number, supplier.lng as number]}
          pathOptions={{
            ...markerStyle(supplier.geocode_tier),
            interactive: true,
            ...(selectedSupplierId === supplier.id
              ? { weight: 3, color: '#67e8f9', fillOpacity: 1 }
              : {}),
          }}
          renderer={bunkerPointRenderer}
          zIndexOffset={900}
          eventHandlers={{
            click: (e) => handleSupplierClick(supplier, e),
          }}
        />
      ))}
    </LayerGroup>
  );
}
