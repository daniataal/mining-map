import { memo, startTransition, useMemo } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useI18n } from '../../lib/i18n';
import type { RoutePlannerHubMarker } from './locationPresets';
import type { RoutePickRole } from './useRoutePlanner';

const PORT_ICON_IDLE = createPortMapIcon(false, false);
const PORT_ICON_PICK = createPortMapIcon(true, false);
const PORT_ICON_EMPHASIZED = createPortMapIcon(false, true);
const PORT_ICON_EMPHASIZED_PICK = createPortMapIcon(true, true);

function createPortMapIcon(active = false, emphasized = false): L.DivIcon {
  const size = active ? (emphasized ? 36 : 30) : emphasized ? 32 : 26;
  const border = active ? '2.5px solid #fbbf24' : '2px solid rgba(255,255,255,0.95)';
  const shadow = emphasized
    ? '0 3px 14px rgba(14,165,233,0.65)'
    : '0 2px 10px rgba(14,165,233,0.45)';
  return new L.DivIcon({
    className: 'route-port-marker',
    html: `<span role="img" aria-label="Port" style="
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:15px;line-height:1;
      background:rgba(14,116,144,0.92);
      border:${border};
      border-radius:50%;
      box-shadow:${shadow};
      cursor:pointer;
    ">⚓</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface RoutePlannerPortMarkersProps {
  ports: RoutePlannerHubMarker[];
  pickRole: RoutePickRole | null;
  onPortPick: (port: RoutePlannerHubMarker, role: RoutePickRole) => void;
  emphasized?: boolean;
}

function RoutePlannerPortMarkers({
  ports,
  pickRole,
  onPortPick,
  emphasized = false,
}: RoutePlannerPortMarkersProps) {
  const { t } = useI18n();
  const icon = pickRole
    ? emphasized
      ? PORT_ICON_EMPHASIZED_PICK
      : PORT_ICON_PICK
    : emphasized
      ? PORT_ICON_EMPHASIZED
      : PORT_ICON_IDLE;
  const zIndex = pickRole ? (emphasized ? 3200 : 2500) : emphasized ? 900 : 400;
  const interactive = Boolean(pickRole);

  const markers = useMemo(
    () =>
      ports.map((port) => (
        <Marker
          key={port.id}
          position={[port.lat, port.lng]}
          icon={icon}
          zIndexOffset={zIndex}
          bubblingMouseEvents={!pickRole}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e.originalEvent);
              L.DomEvent.preventDefault(e.originalEvent);
              if (pickRole) {
                startTransition(() => onPortPick(port, pickRole));
              }
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -12]} opacity={1}>
            <span className="text-[11px] font-bold text-slate-900">
              ⚓ {port.name}
              {port.country ? ` · ${port.country}` : ''}
            </span>
            {!interactive && (
              <p className="text-[9px] text-slate-500 mt-0.5">
                {t('לחצו "מהמפה" על ספק או יעד ואז בחרו נמל', 'Use From map on supplier or destination, then click a port')}
              </p>
            )}
          </Tooltip>
        </Marker>
      )),
    [ports, icon, zIndex, pickRole, interactive, onPortPick, t],
  );

  return <>{markers}</>;
}

export default memo(RoutePlannerPortMarkers);
