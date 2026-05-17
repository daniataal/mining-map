import L from 'leaflet';

const REFINERY_ICON_URL = '/assets/commodities/oil-gas.png';

/** Distinct refinery pin for license rows and petroleum GeoJSON points. */
export function createRefineryMapIcon(selected = false): L.DivIcon {
  const size = selected ? 30 : 24;
  const half = size / 2;
  return new L.DivIcon({
    className: 'refinery-marker',
    html: `<div class="refinery-marker-pin${selected ? ' is-selected' : ''}" style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:linear-gradient(145deg,#1e293b 0%,#0f172a 100%);border:2px solid #fb923c;box-shadow:0 0 10px rgba(251,146,60,0.55),0 2px 6px rgba(0,0,0,0.45);">
<img src="${REFINERY_ICON_URL}" alt="" width="${Math.round(size * 0.62)}" height="${Math.round(size * 0.62)}" style="object-fit:contain;filter:drop-shadow(0 0 2px rgba(251,146,60,0.8));" />
</div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half],
  });
}
