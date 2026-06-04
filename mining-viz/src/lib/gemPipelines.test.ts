import { describe, expect, it } from 'vitest';
import { gemFuelGroupToPopupLayerId, gemPipelineStyle } from './gemPipelineMapStyle';

describe('gemPipelines', () => {
  it('maps ngl to gas pipeline popup layer', () => {
    expect(gemFuelGroupToPopupLayerId('ngl')).toBe('gas_pipelines');
    expect(gemFuelGroupToPopupLayerId('oil')).toBe('oil_pipelines');
  });

  it('dashes inactive status pipelines', () => {
    const proposed = gemPipelineStyle('oil', 'proposed', true);
    expect(proposed.dashArray).toBe('8 6');
    const operating = gemPipelineStyle('oil', 'operating', true);
    expect(operating.dashArray).toBeUndefined();
  });
});
