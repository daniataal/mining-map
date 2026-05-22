import { describe, expect, it } from 'vitest';
import {
  clusterTargetZoom,
  clusterExpandPaddingDeg,
  shouldRenderServerLicenseCluster,
  MIN_SERVER_LICENSE_CLUSTER_COUNT,
} from './licenseMapCluster';
import type { MiningLicense } from '../types';

describe('licenseMapCluster', () => {
  describe('clusterTargetZoom', () => {
    it('increases zoom by 3, capped at 12', () => {
      expect(clusterTargetZoom(5)).toBe(8);
      expect(clusterTargetZoom(9)).toBe(12);
      expect(clusterTargetZoom(11)).toBe(12);
    });

    it('stays at 9 or above', () => {
      expect(clusterTargetZoom(2)).toBe(9);
    });
  });

  describe('clusterExpandPaddingDeg', () => {
    it('uses half grid size if available', () => {
      const item = { mapClusterGridDeg: 4.0 } as MiningLicense;
      expect(clusterExpandPaddingDeg(item)).toBeCloseTo(2.2, 1); // 4.0 * 0.55
    });

    it('returns default padding for small clusters', () => {
      const item = { mapClusterCount: 10 } as MiningLicense;
      expect(clusterExpandPaddingDeg(item)).toBe(0.35);
    });

    it('returns larger padding for huge clusters', () => {
      const item = { mapClusterCount: 200 } as MiningLicense;
      expect(clusterExpandPaddingDeg(item)).toBe(1.0);
    });
  });

  describe('shouldRenderServerLicenseCluster', () => {
    it('returns true if count is above threshold', () => {
      const item = { mapClusterCount: MIN_SERVER_LICENSE_CLUSTER_COUNT } as MiningLicense;
      expect(shouldRenderServerLicenseCluster(item)).toBe(true);
    });

    it('returns false if count is below threshold', () => {
      const item = { mapClusterCount: MIN_SERVER_LICENSE_CLUSTER_COUNT - 1 } as MiningLicense;
      expect(shouldRenderServerLicenseCluster(item)).toBe(false);
    });

    it('returns false if count is missing', () => {
      const item = {} as MiningLicense;
      expect(shouldRenderServerLicenseCluster(item)).toBe(false);
    });
  });
});
