import { describe, expect, it } from 'vitest';
import { gemPlantMarkerStyle } from './gemPlantMapStyle';

describe('gemPlantMapStyle', () => {
  it('dims inactive plant markers', () => {
    const proposed = gemPlantMarkerStyle('gas', 'proposed', true);
    expect(proposed.fillOpacity).toBe(0.55);
    const operating = gemPlantMarkerStyle('gas', 'operating', true);
    expect(operating.fillOpacity).toBe(0.88);
  });
});
