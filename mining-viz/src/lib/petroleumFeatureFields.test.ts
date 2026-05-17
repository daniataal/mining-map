import { describe, expect, it } from 'vitest';
import { buildPetroleumFeatureViewModel } from './petroleumFeatureFields';

describe('buildPetroleumFeatureViewModel', () => {
  it('prefers Name as title and Company as operator', () => {
    const model = buildPetroleumFeatureViewModel(
      {
        Name: '502 - Metro Oil Corp. - Fujairah',
        Company: 'Metro Oil Corp',
        Country: 'United Arab Emirates',
        STATUS: 'Operating',
      },
      'refineries'
    );
    expect(model.title).toBe('502 - Metro Oil Corp. - Fujairah');
    expect(model.country).toBe('United Arab Emirates');
    expect(model.status).toBe('Operating');
  });

  it('does not duplicate name rows in extra fields', () => {
    const model = buildPetroleumFeatureViewModel({ Name: 'Alpha Refinery', Type: 'Refinery' }, 'refineries');
    expect(model.extraRows.some((r) => r.label.toLowerCase().includes('name'))).toBe(false);
  });
});
