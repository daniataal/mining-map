import { memo, startTransition, useMemo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useI18n } from '../../lib/i18n';
import type { RoutePlannerHubMarker } from './locationPresets';
import type { RoutePickRole } from './useRoutePlanner';

const AIRPORT_ICON_IDLE = createAirportMapIcon(false, false);
const AIRPORT_ICON_PICK = createAirportMapIcon(true, false);
const AIRPORT_ICON_EMPHASIZED = createAirportMapIcon(false, true);
const AIRPORT_ICON_EMPHASIZED_PICK = createAirportMapIcon(true, true);

function createAirportMapIcon(active = false, emphasized = false): L.DivIcon {
  const size = active ? (emphasized ? 36 : 30) : emphasized ? 32 : 26;
  const border = active ? '2.5px solid #fbbf24' : '2px solid rgba(255,255,255,0.95)';
  const shadow = emphasized
    ? '0 3px 14px rgba(99,102,241,0.65)'
    : '0 2px 10px rgba(99,102,241,0.45)';
  return new L.DivIcon({
    className: 'route-airport-marker',
    html: `<span role="img" aria-label="Airport" style="
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:14px;line-height:1;
      background:rgba(79,70,229,0.92);
      border:${border};
      border-radius:50%;
      box-shadow:${shadow};
      cursor:pointer;
    ">✈</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface RoutePlannerAirportMarkersProps {
  airports: RoutePlannerHubMarker[];
  pickRole: RoutePickRole | null;
  onAirportPick: (airport: RoutePlannerHubMarker, role: RoutePickRole) => void;
  emphasized?: boolean;
}

function RoutePlannerAirportMarkers({
  airports,
  pickRole,
  onAirportPick,
  emphasized = false,
}: RoutePlannerAirportMarkersProps) {
  const { t } = useI18n();
  const icon = pickRole
    ? emphasized
      ? AIRPORT_ICON_EMPHASIZED_PICK
      : AIRPORT_ICON_PICK
    : emphasized
      ? AIRPORT_ICON_EMPHASIZED
      : AIRPORT_ICON_IDLE;
  const zIndex = pickRole ? (emphasized ? 3210 : 2510) : emphasized ? 910 : 410;
  const interactive = Boolean(pickRole);

  const markers = useMemo(
    () =>
      airports.map((airport) => (
        <Marker
          key={airport.id}
          position={[airport.lat, airport.lng]}
          icon={icon}
          zIndexOffset={zIndex}
          bubblingMouseEvents={!pickRole}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent);
              L.DomEvent.preventDefault(e.originalEvent);
              if (pickRole) {
                startTransition(() => onAirportPick(airport, pickRole));
              }
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -12]} opacity={1}>
            <span className="text-[11px] font-bold text-slate-900">
              ✈ {airport.name}
              {airport.country ? ` · ${airport.country}` : ''}
            </span>
            {!interactive && (
              <p className="text-[9px] text-slate-500 mt-0.5">
                {t(
                  'לחצו "מהמפה" על ספק או יעד ואז בחרו שדה תעופה',
                  'Use From map on supplier or destination, then click an airport',
                )}
              </p>
            )}
          </Tooltip>
        </Marker>
      )),
    [airports, icon, zIndex, pickRole, interactive, onAirportPick, t],
  );

  return <>{markers}</>;
}

export default memo(RoutePlannerAirportMarkers);
