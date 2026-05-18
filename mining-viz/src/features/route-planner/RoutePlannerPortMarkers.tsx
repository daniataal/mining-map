import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useI18n } from '../../lib/i18n';
import type { RoutePlannerPortMarker } from './locationPresets';
import type { RoutePickRole } from './useRoutePlanner';

function createPortMapIcon(active = false): L.DivIcon {
  const size = active ? 30 : 26;
  const border = active ? '2.5px solid #fbbf24' : '2px solid rgba(255,255,255,0.95)';
  return new L.DivIcon({
    className: 'route-port-marker',
    html: `<span role="img" aria-label="Port" style="
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:15px;line-height:1;
      background:rgba(14,116,144,0.92);
      border:${border};
      border-radius:50%;
      box-shadow:0 2px 10px rgba(14,165,233,0.45);
      cursor:pointer;
    ">⚓</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

interface RoutePlannerPortMarkersProps {
  ports: RoutePlannerPortMarker[];
  pickRole: RoutePickRole | null;
  onPortPick: (port: RoutePlannerPortMarker, role: RoutePickRole) => void;
}

export default function RoutePlannerPortMarkers({ ports, pickRole, onPortPick }: RoutePlannerPortMarkersProps) {
  const { t } = useI18n();

  return (
    <>
      {ports.map((port) => (
        <Marker
          key={port.id}
          position={[port.lat, port.lng]}
          icon={createPortMapIcon(Boolean(pickRole))}
          zIndexOffset={pickRole ? 600 : 400}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              if (pickRole) onPortPick(port, pickRole);
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -12]} opacity={1}>
            <span className="text-[11px] font-bold text-slate-900">
              ⚓ {port.name}
              {port.country ? ` · ${port.country}` : ''}
            </span>
            {!pickRole && (
              <p className="text-[9px] text-slate-500 mt-0.5">
                {t('לחצו "מהמפה" על ספק או יעד ואז בחרו נמל', 'Use From map on supplier or destination, then click a port')}
              </p>
            )}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
