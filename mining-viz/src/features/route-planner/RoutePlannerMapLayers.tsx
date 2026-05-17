import { Fragment, useMemo } from 'react';
import { Marker, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useI18n } from '../../lib/i18n';
import type { RouteLeg, RouteMapOverlay } from './types';
import {
  createRouteMethodIcon,
  getRouteMethodStyle,
  hubMarkerColor,
  hubRoleLabel,
  normalizeHubKind,
  normalizeRouteMethod,
  pathMidpoint,
} from './routeMapStyles';

function createHubLabelIcon(text: string, color: string): L.DivIcon {
  const safe = text.length > 28 ? `${text.slice(0, 26)}…` : text;
  return new L.DivIcon({
    className: 'route-hub-label',
    html: `<span style="
      display:inline-block;max-width:140px;padding:2px 6px;
      font:700 9px/1.2 system-ui,sans-serif;letter-spacing:0.02em;
      color:#0f172a;background:rgba(255,255,255,0.94);
      border:1px solid ${color};border-radius:6px;
      box-shadow:0 2px 6px rgba(0,0,0,0.2);white-space:nowrap;
    ">${safe}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 14],
  });
}

interface HubMarker {
  key: string;
  lat: number;
  lng: number;
  kind: ReturnType<typeof normalizeHubKind>;
  name: string;
  showLabel: boolean;
}

function collectHubMarkers(legs: RouteLeg[]): HubMarker[] {
  const hubs: HubMarker[] = [];
  const seen = new Set<string>();

  legs.forEach((leg, idx) => {
    if (!leg.path.length) return;
    const end = leg.path[leg.path.length - 1];
    const isLast = idx === legs.length - 1;
    if (isLast) return;

    const kind = normalizeHubKind(leg.toKind);
    const name = leg.hubLabel || leg.toName;
    if (!name) return;

    const isGateway = kind === 'port' || kind === 'airport' || kind === 'rail_hub';
    const prevMethod = idx > 0 ? normalizeRouteMethod(legs[idx - 1].method) : null;
    const nextMethod = normalizeRouteMethod(leg.method);
    const methodChanges = idx === 0 || (prevMethod && prevMethod !== nextMethod);

    if (!isGateway && !methodChanges) return;

    const key = `${end[0].toFixed(4)}:${end[1].toFixed(4)}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);

    hubs.push({
      key,
      lat: end[0],
      lng: end[1],
      kind,
      name,
      showLabel: isGateway || Boolean(methodChanges),
    });
  });

  return hubs;
}

interface RoutePlannerMapLayersProps {
  overlay: RouteMapOverlay;
}

export default function RoutePlannerMapLayers({ overlay }: RoutePlannerMapLayersProps) {
  const { t } = useI18n();

  const hubMarkers = useMemo(() => collectHubMarkers(overlay.legs), [overlay.legs]);

  return (
    <>
      {overlay.legs.map((leg, idx) => {
        if (!Array.isArray(leg.path) || leg.path.length < 2) return null;
        const style = getRouteMethodStyle(leg.method);
        const mid = pathMidpoint(leg.path);
        const legCaption = leg.label || `${style.labelEn}${leg.toName ? `: ${leg.toName}` : ''}`;

        return (
          <Fragment key={`rp-leg-${idx}`}>
            <Polyline
              positions={leg.path}
              pathOptions={{
                weight: style.weight,
                color: style.color,
                opacity: 0.92,
                lineCap: 'round',
                lineJoin: 'round',
                ...(style.dashArray ? { dashArray: style.dashArray } : {}),
              }}
            >
              <Tooltip direction="top" opacity={1}>
                <span className="text-[11px] font-bold text-slate-900">{legCaption}</span>
              </Tooltip>
            </Polyline>
            {mid && (
              <Marker position={mid} icon={createRouteMethodIcon(leg.method)} interactive={false}>
                <Tooltip direction="center" permanent opacity={0.95} className="route-leg-method-tip">
                  <span className="text-[9px] font-black uppercase tracking-wide text-slate-800">
                    {style.icon} {t(style.labelHe, style.labelEn)}
                  </span>
                </Tooltip>
              </Marker>
            )}
          </Fragment>
        );
      })}

      {hubMarkers.map((hub) => {
        const color = hubMarkerColor(hub.kind);
        const role = hubRoleLabel(hub.kind);
        const radius = hub.kind === 'port' ? 11 : hub.kind === 'airport' ? 10 : 9;
        return (
          <Fragment key={hub.key}>
            <CircleMarker
              center={[hub.lat, hub.lng]}
              radius={radius}
              pathOptions={{
                fillColor: color,
                color: 'rgba(255,255,255,0.95)',
                weight: 2.5,
                fillOpacity: 0.95,
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <span className="text-[11px] font-bold text-slate-900">
                  {t(role[0], role[1])}: {hub.name}
                </span>
              </Tooltip>
            </CircleMarker>
            {hub.showLabel && (
              <Marker
                position={[hub.lat, hub.lng]}
                icon={createHubLabelIcon(hub.name, color)}
                interactive={false}
                zIndexOffset={400}
              />
            )}
          </Fragment>
        );
      })}

      {overlay.waypoints.map((wp, i) => {
        let fill = '#22c55e';
        if (wp.role === 'transit') fill = '#38bdf8';
        if (wp.role === 'destination') fill = '#f43f5e';
        const r = wp.role === 'destination' ? 14 : wp.role === 'origin' ? 13 : 10;
        return (
          <CircleMarker
            key={`rp-wp-${i}-${wp.role}`}
            center={[wp.lat, wp.lng]}
            radius={r}
            pathOptions={{
              fillColor: fill,
              color: 'rgba(255,255,255,0.9)',
              weight: 2,
              fillOpacity: 0.9,
            }}
          >
            <Tooltip direction="top" offset={[0, -12]} opacity={1}>
              <span className="text-[11px] font-bold text-slate-900">{t(wp.label[0], wp.label[1])}</span>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
