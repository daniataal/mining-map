import { describe, it, expect } from 'vitest';
import { sourceQualityTier, sourceQualityWarning } from './sourceQuality';

describe('sourceQuality', () => {
  it('classifies official registry', () => {
    expect(sourceQualityTier({ sourceKind: 'official_registry' })).toBe('official');
    expect(sourceQualityWarning('official')).toBeNull();
  });

  it('warns on bundled fallback', () => {
    expect(sourceQualityTier({ sourceKind: 'bundled_json' })).toBe('fallback');
    expect(sourceQualityWarning('fallback')).toContain('fallback');
  });
});
