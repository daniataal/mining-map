import L from 'leaflet';
import type { RouteLeg } from './types';

export type NormalizedRouteMethod = 'road' | 'sea' | 'air' | 'rail' | 'pipeline';

export interface RouteMethodStyle {
  color: string;
  weight: number;
  dashArray?: string;
  icon: string;
  labelHe: string;
  labelEn: string;
  legendLine: 'solid' | 'dashed';
}

export const ROUTE_METHOD_STYLES: Record<NormalizedRouteMethod, RouteMethodStyle> = {
  road: {
    color: '#f59e0b',
    weight: 3,
    icon: '🚛',
    labelHe: 'כביש / משאית',
    labelEn: 'Road',
    legendLine: 'solid',
  },
  sea: {
    color: '#38bdf8',
    weight: 4,
    dashArray: '14 12',
    icon: '🚢',
    labelHe: 'ים',
    labelEn: 'Sea',
    legendLine: 'dashed',
  },
  air: {
    color: '#a78bfa',
    weight: 3,
    dashArray: '6 10',
    icon: '✈️',
    labelHe: 'אוויר',
    labelEn: 'Air',
    legendLine: 'dashed',
  },
  rail: {
    color: '#22c55e',
    weight: 3,
    dashArray: '10 8',
    icon: '🚂',
    labelHe: 'רכבת',
    labelEn: 'Rail',
    legendLine: 'dashed',
  },
  pipeline: {
    color: '#f97316',
    weight: 3,
    dashArray: '4 6',
    icon: '⛽',
    labelHe: 'צנרת',
    labelEn: 'Pipeline',
    legendLine: 'dashed',
  },
};

export const ROUTE_LEGEND_ORDER: NormalizedRouteMethod[] = ['road', 'sea', 'air', 'rail'];

export function normalizeRouteMethod(method?: string): NormalizedRouteMethod {
  const m = (method || 'road').toLowerCase();
  if (m === 'sea') return 'sea';
  if (m === 'air') return 'air';
  if (m === 'rail') return 'rail';
  if (m === 'pipeline') return 'pipeline';
  if (m === 'truck' || m === 'road') return 'road';
  return 'road';
}

export function getRouteMethodStyle(method?: string): RouteMethodStyle {
  return ROUTE_METHOD_STYLES[normalizeRouteMethod(method)];
}

export function pathMidpoint(path: [number, number][]): [number, number] | null {
  if (!path.length) return null;
  if (path.length === 1) return path[0];
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1];
    const [bLat, bLng] = path[i];
    const dLat = bLat - aLat;
    const dLng = bLng - aLng;
    const len = Math.hypot(dLat, dLng);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) return path[Math.floor(path.length / 2)];
  let half = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (half <= segLens[i]) {
      const t = segLens[i] > 0 ? half / segLens[i] : 0;
      const [aLat, aLng] = path[i];
      const [bLat, bLng] = path[i + 1];
      return [aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t];
    }
    half -= segLens[i];
  }
  return path[path.length - 1];
}

export function createRouteMethodIcon(method?: string): L.DivIcon {
  const style = getRouteMethodStyle(method);
  const size = 26;
  return new L.DivIcon({
    className: 'route-method-icon',
    html: `<span role="img" aria-label="${style.labelEn}" style="
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      font-size:14px;line-height:1;
      background:rgba(15,23,42,0.88);
      border:2px solid ${style.color};
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
    ">${style.icon}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export type HubKind = 'port' | 'airport' | 'rail_hub' | 'origin' | 'destination' | 'transit';

export function normalizeHubKind(kind?: string): HubKind {
  const k = (kind || '').toLowerCase();
  if (k === 'port') return 'port';
  if (k === 'airport') return 'airport';
  if (k === 'rail_hub' || k === 'rail') return 'rail_hub';
  if (k === 'origin') return 'origin';
  if (k === 'destination') return 'destination';
  return 'transit';
}

export function hubMarkerColor(kind: HubKind): string {
  if (kind === 'port') return '#38bdf8';
  if (kind === 'airport') return '#a78bfa';
  if (kind === 'rail_hub') return '#22c55e';
  if (kind === 'destination') return '#f43f5e';
  if (kind === 'origin') return '#22c55e';
  return '#94a3b8';
}

export function hubRoleLabel(kind: HubKind): [string, string] {
  if (kind === 'port') return ['נמל', 'Port'];
  if (kind === 'airport') return ['נמל תעופה', 'Airport'];
  if (kind === 'rail_hub') return ['מרכז רכבת', 'Rail hub'];
  if (kind === 'origin') return ['מוצא', 'Origin'];
  if (kind === 'destination') return ['יעד', 'Destination'];
  return ['מעבר', 'Transit'];
}

export function legMethodLabel(method?: string): [string, string] {
  const style = getRouteMethodStyle(method);
  return [style.labelHe, style.labelEn];
}

export function shortLegCaption(leg: RouteLeg): string {
  const style = getRouteMethodStyle(leg.method);
  if (leg.hubLabel) return `${style.labelEn}: ${leg.hubLabel}`;
  if (leg.toName) return `${style.labelEn} → ${leg.toName}`;
  return leg.label || style.labelEn;
}
