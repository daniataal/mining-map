import { describe, expect, it } from 'vitest';
import { clusterIconSizeForTier, clusterTierForCount } from './clusterTier';

describe('clusterTierForCount', () => {
  it('classifies tiers by count thresholds', () => {
    expect(clusterTierForCount(10)).toBe('small');
    expect(clusterTierForCount(100)).toBe('medium');
    expect(clusterTierForCount(800)).toBe('large');
    expect(clusterTierForCount(3000)).toBe('hotspot');
  });
});

describe('clusterIconSizeForTier', () => {
  it('returns increasing sizes for higher tiers', () => {
    expect(clusterIconSizeForTier('small')).toBeLessThan(clusterIconSizeForTier('medium'));
    expect(clusterIconSizeForTier('medium')).toBeLessThan(clusterIconSizeForTier('large'));
    expect(clusterIconSizeForTier('large')).toBeLessThan(clusterIconSizeForTier('hotspot'));
  });
});
