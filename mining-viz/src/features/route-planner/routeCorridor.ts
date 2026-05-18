import type { RouteMapOverlay } from './types';

/** Regional heuristics for corridor validation (aligned with backend route_planner). */

export function isWestAfrica(lat: number, lng: number): boolean {
  return lat >= -10 && lat <= 25 && lng >= -25 && lng <= 20;
}

export function isLevant(lat: number, lng: number): boolean {
  return lat >= 28 && lat < 36 && lng >= 25 && lng <= 42;
}

function countryHintsGhana(country?: string): boolean {
  const c = (country ?? '').toLowerCase();
  return c.includes('ghana');
}

function countryHintsIsrael(country?: string): boolean {
  const c = (country ?? '').toLowerCase();
  return c.includes('israel');
}

/** Warn when supplier/buyer roles look reversed for a West Africa → Levant trade lane. */
export function detectLikelySupplierBuyerReversal(
  supplier: { lat: number; lng: number; country?: string },
  buyer: { lat: number; lng: number; country?: string },
): string | null {
  const supplierWestAfrica =
    countryHintsGhana(supplier.country) || isWestAfrica(supplier.lat, supplier.lng);
  const buyerLevant = countryHintsIsrael(buyer.country) || isLevant(buyer.lat, buyer.lng);
  const supplierLevant =
    countryHintsIsrael(supplier.country) || isLevant(supplier.lat, supplier.lng);
  const buyerWestAfrica =
    countryHintsGhana(buyer.country) || isWestAfrica(buyer.lat, buyer.lng);

  if (supplierLevant && buyerWestAfrica && !(supplierWestAfrica && buyerLevant)) {
    return (
      'Supplier is in Israel/Levant and destination is in West Africa — the map will route export ' +
      'from Haifa toward Ghana. For Ghana → Israel exports, set Ghana as supplier (origin) and Israel as buyer (destination).'
    );
  }
  return null;
}

export function attachSupplierBuyerEnds(
  map: RouteMapOverlay,
  supplier: { lat: number; lng: number; label?: string },
  buyer: { lat: number; lng: number; label?: string },
): RouteMapOverlay {
  const fromLabel = supplier.label?.trim() || 'Supplier';
  const toLabel = buyer.label?.trim() || 'Destination';
  const transit = map.waypoints.filter((wp) => wp.role === 'transit');
  return {
    ...map,
    ends: {
      from: { lat: supplier.lat, lng: supplier.lng, label: fromLabel, role: 'supplier' },
      to: { lat: buyer.lat, lng: buyer.lng, label: toLabel, role: 'buyer' },
    },
    waypoints: [
      {
        lat: supplier.lat,
        lng: supplier.lng,
        role: 'origin',
        label: ['מוצא (ספק)', `From: ${fromLabel}`],
      },
      ...transit,
      {
        lat: buyer.lat,
        lng: buyer.lng,
        role: 'destination',
        label: ['יעד (קונה)', `To: ${toLabel}`],
      },
    ],
  };
}
