import { describe, expect, it } from 'vitest';
import { unwrapLongitudePath } from './unwrapLongitudePath';

describe('unwrapLongitudePath', () => {
  it('unwraps lng so path does not cross the long way', () => {
    const path = unwrapLongitudePath([
      [24, 45],
      [29, -95],
    ]);
    expect(path[1][1]).toBeGreaterThan(path[0][1]);
  });
});
