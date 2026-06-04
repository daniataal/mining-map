import { describe, expect, it } from 'vitest';
import {
  resolvePetroleumViewportBounds,
} from './petroleumViewportBounds';

describe('resolvePetroleumViewportBounds', () => {
  it('returns null when viewport is missing', () => {
    expect(resolvePetroleumViewportBounds(null)).toBeNull();
    expect(resolvePetroleumViewportBounds(undefined)).toBeNull();
  });

  it('keeps a valid tracked viewport', () => {
    const viewport = { south: 10, west: 20, north: 30, east: 40 };
    expect(resolvePetroleumViewportBounds(viewport)).toEqual(viewport);
  });
});
