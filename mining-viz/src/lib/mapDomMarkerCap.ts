import type { MaritimeViewportBounds } from '../types';
import { LICENSE_MAP_DOM_MARKER_CAP } from './mapViewportDebounce';

export type MapMarkerCapItem = {
  id: string;
  lat?: number | null;
  lng?: number | null;
  _displayLat?: number | null;
  _displayLng?: number | null;
};

function markerLatLng(item: MapMarkerCapItem): { lat: number; lng: number } | null {
  const lat = item._displayLat ?? item.lat;
  const lng = item._displayLng ?? item.lng;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Keep at most `limit` markers in viewport; always retain `selectedId` when set. */
export function capMarkersInViewport<T extends MapMarkerCapItem>(
  items: T[],
  viewport: MaritimeViewportBounds | null,
  limit = LICENSE_MAP_DOM_MARKER_CAP,
  selectedId?: string | null,
): { data: T[]; capped: boolean } {
  if (items.length <= limit) {
    return { data: items, capped: false };
  }
  if (!viewport) {
    return { data: items.slice(0, limit), capped: true };
  }

  const filtered: T[] = [];
  for (const item of items) {
    const ll = markerLatLng(item);
    if (!ll) continue;
    if (selectedId && item.id === selectedId) {
      filtered.push(item);
      continue;
    }
    if (
      ll.lat >= viewport.south &&
      ll.lat <= viewport.north &&
      ll.lng >= viewport.west &&
      ll.lng <= viewport.east
    ) {
      filtered.push(item);
    }
  }

  if (filtered.length <= limit) {
    return { data: filtered, capped: filtered.length < items.length };
  }

  const capped = filtered.slice(0, limit);
  if (selectedId) {
    const selected = filtered.find((item) => item.id === selectedId);
    if (selected && !capped.some((item) => item.id === selected.id)) {
      capped[capped.length - 1] = selected;
    }
  }
  return { data: capped, capped: true };
}
