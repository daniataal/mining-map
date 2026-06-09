import { CircleMarker, LayerGroup, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { PathOptions } from 'leaflet';
import { ExternalLink } from 'lucide-react';
import type { NearbySupplier } from '../../lib/nearbySuppliers';
import { useI18n } from '../../lib/i18n';
import { markMapFeatureClickHandled } from '../../lib/mapInteractionController';

/** SVG renderer — MapContainer preferCanvas breaks CircleMarker hit testing. */
const bunkerPointRenderer = L.svg({ padding: 0.5 });

type Props = {
  suppliers: NearbySupplier[];
  enabled?: boolean;
  onOpenDossier?: (supplier: NearbySupplier) => void;
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

export default function NearbySuppliersMapLayer({ suppliers, enabled = true, onOpenDossier }: Props) {
  const { t } = useI18n();
  if (!enabled) return null;

  const mappable = suppliers.filter((s) => s.lat != null && s.lng != null);
  if (mappable.length === 0) return null;

  return (
    <LayerGroup>
      {mappable.map((supplier) => (
        <CircleMarker
          key={supplier.id}
          center={[supplier.lat as number, supplier.lng as number]}
          pathOptions={{ ...markerStyle(supplier.geocode_tier), interactive: true }}
          renderer={bunkerPointRenderer}
          zIndexOffset={900}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              markMapFeatureClickHandled(e);
              (e.target as L.CircleMarker).openPopup();
            },
          }}
        >
          <Popup maxWidth={280}>
            <div className="space-y-1 text-xs text-slate-800">
              <p className="font-semibold">{supplier.name}</p>
              {supplier.geocode_tier && (
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{supplier.geocode_tier.replace(/_/g, ' ')}</p>
              )}
              {supplier.fuels_supplied && (
                <p>
                  {t('דלקים', 'Fuels')}: {supplier.fuels_supplied}
                </p>
              )}
              {supplier.contact_person && (
                <p>
                  {t('איש קשר', 'Contact')}: {supplier.contact_person}
                </p>
              )}
              {supplier.address && <p className="leading-snug">{supplier.address}</p>}
              {supplier.geocode_disclaimer && (
                <p className="text-[10px] leading-snug text-slate-500">{supplier.geocode_disclaimer}</p>
              )}
              {onOpenDossier && (
                <button
                  type="button"
                  className="mt-1 text-cyan-700 underline"
                  onClick={() => onOpenDossier(supplier)}
                >
                  {t('פתח תיק', 'Open dossier')}
                </button>
              )}
              {supplier.source_url && (
                <a
                  href={supplier.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-amber-700"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('מקור', 'Source')}
                </a>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </LayerGroup>
  );
}
