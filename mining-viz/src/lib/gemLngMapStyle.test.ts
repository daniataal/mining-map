import { describe, expect, it } from 'vitest';
import { gemLngMarkerStyle } from './gemLngMapStyle';

describe('gemLngMarkerStyle', () => {
  it('uses export hue for export terminals', () => {
    const style = gemLngMarkerStyle('export', 'operating', true);
    expect(style.fillColor).toBe('#38bdf8');
  });

  it('uses import hue by default', () => {
    const style = gemLngMarkerStyle('import', 'operating', true);
    expect(style.fillColor).toBe('#a78bfa');
  });
});
