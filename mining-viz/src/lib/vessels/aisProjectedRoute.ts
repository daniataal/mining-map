import type { MaritimePortReference, MaritimeVessel } from './types';
import { greatCirclePath } from './greatCirclePath';
import type { LatLngTuple } from '../corridorGeometry';
import { unwrapLongitudePath } from '../unwrapLongitudePath';

export type AisDestinationEndpoint = {
  lat: number;
  lng: number;
  label: string;
  matchKind: 'port_name' | 'unlocode';
};

export type AisProjectedRouteResult =
  | { status: 'ready'; path: LatLngTuple[]; endpoint: AisDestinationEndpoint }
  | { status: 'no_destination' }
  | { status: 'destination_no_coords'; destination: string };

function normalizeAisText(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function portMatchesDestination(port: MaritimePortReference, destination: string): boolean {
  const dest = normalizeAisText(destination);
  if (!dest) return false;
  const name = normalizeAisText(port.name);
  const locode = (port.unlocode ?? '').trim().toUpperCase();
  const destCompact = dest.replace(/\s+/g, '');
  const locodeCompact = locode.replace(/\s+/g, '');
  if (locodeCompact.length >= 4 && destCompact.includes(locodeCompact)) return true;
  if (locode.length >= 4 && dest.includes(locode)) return true;
  if (name.length >= 3 && (dest.includes(name) || name.includes(dest))) return true;
  const destTokens = dest.split(/\s+/).filter((t) => t.length >= 3);
  const nameTokens = name.split(/\s+/).filter((t) => t.length >= 3);
  return destTokens.some((token) => nameTokens.some((nt) => nt.includes(token) || token.includes(nt)));
}

/** Resolve AIS destination text to a port coordinate when we have an explicit port match. */
export function resolveAisDestinationEndpoint(vessel: MaritimeVessel): AisDestinationEndpoint | null {
  const destination = String(vessel.destination ?? '').trim();
  if (!destination) return null;
  const port = vessel.nearest_port;
  if (!port || port.lat == null || port.lng == null) return null;
  if (!portMatchesDestination(port, destination)) return null;
  const locode = (port.unlocode ?? '').trim().toUpperCase();
  const destNorm = normalizeAisText(destination);
  const destCompact = destNorm.replace(/\s+/g, '');
  const locodeCompact = locode.replace(/\s+/g, '');
  const matchKind: AisDestinationEndpoint['matchKind'] =
    locodeCompact.length >= 4 && destCompact.includes(locodeCompact) ? 'unlocode' : 'port_name';
  return {
    lat: port.lat,
    lng: port.lng,
    label: port.name,
    matchKind,
  };
}

export function buildAisProjectedRoute(vessel: MaritimeVessel): AisProjectedRouteResult {
  const destination = String(vessel.destination ?? '').trim();
  if (!destination) return { status: 'no_destination' };
  const endpoint = resolveAisDestinationEndpoint(vessel);
  if (!endpoint) return { status: 'destination_no_coords', destination };
  const from: LatLngTuple = [vessel.lat, vessel.lng];
  const to: LatLngTuple = [endpoint.lat, endpoint.lng];
  const path = unwrapLongitudePath(greatCirclePath(from, to));
  return { status: 'ready', path, endpoint };
}
