import { describe, expect, it } from 'vitest';
import { countEntitiesInViewport } from './viewportBounds';

describe('countEntitiesInViewport', () => {
  it('returns all entities when viewport is null', () => {
    expect(
      countEntitiesInViewport(
        [
          { lat: 25, lng: 55 },
          { lat: 1, lng: 2 },
        ],
        null,
      ),
    ).toBe(2);
  });

  it('counts only entities inside bounds', () => {
    expect(
      countEntitiesInViewport(
        [
          { lat: 25, lng: 55 },
          { lat: 40, lng: -74 },
        ],
        { south: 20, west: 50, north: 30, east: 60 },
      ),
    ).toBe(1);
  });
});
