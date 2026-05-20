import type { MiningLicense } from '../types';

export interface ViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Count entities with coordinates inside the map viewport (inclusive bounds). */
export function countEntitiesInViewport(
  entities: Pick<MiningLicense, 'lat' | 'lng'>[],
  viewport: ViewportBounds | null,
): number {
  if (!viewport) return entities.length;
  let count = 0;
  for (const entity of entities) {
    if (entity.lat == null || entity.lng == null) continue;
    if (
      entity.lat >= viewport.south &&
      entity.lat <= viewport.north &&
      entity.lng >= viewport.west &&
      entity.lng <= viewport.east
    ) {
      count += 1;
    }
  }
  return count;
}
