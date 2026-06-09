import L from 'leaflet';
import type { MaritimeVessel } from '../../types';

export type VesselMapPreviewHandle = {
  close: () => void;
};

export function openVesselMapPreviewOnMap(
  map: L.Map,
  latlng: L.LatLngExpression,
  vessel: MaritimeVessel,
  onOpenPanel: (vessel: MaritimeVessel) => void,
): VesselMapPreviewHandle {
  const popup = L.popup({
    className: 'vessel-map-preview-popup',
    maxWidth: 280,
    closeButton: true,
    autoPan: true,
  })
    .setLatLng(latlng)
    .setContent(
      `<div class="space-y-2 p-0.5">
        <p class="text-[10px] font-black uppercase tracking-widest text-cyan-300">${escapeHtml(vessel.vessel_name)}</p>
        <p class="text-[11px] text-slate-300 leading-snug">${escapeHtml(
          [
            vessel.ship_type_label,
            vessel.speed_knots != null ? `${vessel.speed_knots} kn` : null,
            vessel.nearest_port?.name,
          ]
            .filter(Boolean)
            .join(' · '),
        )}</p>
        <button type="button" data-vessel-preview-open class="mt-1 w-full rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100 hover:bg-cyan-500/25">
          Open vessel dossier
        </button>
      </div>`,
    )
    .openOn(map);

  const container = popup.getElement();
  const button = container?.querySelector('[data-vessel-preview-open]');
  const onOpen = () => {
    popup.close();
    onOpenPanel(vessel);
  };
  button?.addEventListener('click', onOpen);

  return {
    close: () => {
      button?.removeEventListener('click', onOpen);
      popup.close();
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
