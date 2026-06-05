import { describe, expect, it } from 'vitest';
import {
  quantizePetroleumViewportBounds,
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

describe('quantizePetroleumViewportBounds', () => {
  it('rounds edges to reduce query-key churn', () => {
    expect(
      quantizePetroleumViewportBounds({
        south: 24.123456,
        west: 54.987654,
        north: 25.555555,
        east: 55.111111,
      }),
    ).toEqual({ south: 24.12, west: 54.99, north: 25.56, east: 55.11 });
  });
});
