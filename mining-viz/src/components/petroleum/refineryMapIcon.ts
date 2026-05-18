import L from 'leaflet';

const REFINERY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style="display:block;flex-shrink:0;">
  <rect x="2.5" y="7" width="3" height="7" rx="0.5" fill="#fb923c"/>
  <rect x="10.5" y="5" width="3" height="9" rx="0.5" fill="#fb923c"/>
  <rect x="6.5" y="9" width="2.5" height="5" rx="0.5" fill="#fdba74"/>
  <circle cx="4" cy="5.5" r="1.4" fill="#fdba74" opacity="0.9"/>
  <circle cx="12" cy="3.8" r="1.4" fill="#fdba74" opacity="0.9"/>
  <circle cx="7.75" cy="7.2" r="1.1" fill="#fdba74" opacity="0.75"/>
</svg>`;

const OIL_FIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style="display:block;flex-shrink:0;">
  <path d="M8 2.5c-2.2 0-4 1.6-4 3.6 0 2.8 4 7.4 4 7.4s4-4.6 4-7.4c0-2-1.8-3.6-4-3.6z" fill="#0f172a" stroke="#38bdf8" stroke-width="1.1"/>
  <circle cx="8" cy="6" r="1.35" fill="#38bdf8"/>
</svg>`;

function buildPetroleumPinIcon(
  innerSvg: string,
  className: string,
  borderColor: string,
  glowColor: string,
  selected: boolean,
  size: number
): L.DivIcon {
  const half = size / 2;
  const inner = Math.round(size * 0.58);
  return new L.DivIcon({
    className,
    html: `<div class="${className}-pin${selected ? ' is-selected' : ''}" style="width:${size}px;height:${size}px;box-sizing:border-box;overflow:hidden;display:flex;align-items:center;justify-content:center;border-radius:50%;background:linear-gradient(145deg,#1e293b 0%,#0f172a 100%);border:2px solid ${borderColor};box-shadow:0 0 10px ${glowColor},0 2px 6px rgba(0,0,0,0.45);">
${innerSvg.replace('viewBox="0 0 16 16"', `viewBox="0 0 16 16" width="${inner}" height="${inner}"`)}
</div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
    popupAnchor: [0, -half],
  });
}

/** Distinct refinery pin for license rows and petroleum GeoJSON points (inline SVG — no hero JPEG). */
export function createRefineryMapIcon(selected = false): L.DivIcon {
  const size = selected ? 30 : 24;
  return buildPetroleumPinIcon(
    REFINERY_SVG,
    'refinery-marker',
    '#fb923c',
    'rgba(251,146,60,0.55)',
    selected,
    size
  );
}

/** Oil field / producing asset pin — distinct from refinery (e.g. Zakum). */
export function createOilFieldMapIcon(selected = false): L.DivIcon {
  const size = selected ? 28 : 22;
  return buildPetroleumPinIcon(
    OIL_FIELD_SVG,
    'oil-field-marker',
    '#38bdf8',
    'rgba(56,189,248,0.45)',
    selected,
    size
  );
}
