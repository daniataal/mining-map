import { describe, expect, it } from 'vitest';
import {
  clusterTargetZoom,
  clusterExpandPaddingDeg,
  planClusterDrillFly,
  resolveLicenseMapGoEnabled,
  shouldRenderServerLicenseCluster,
  serverClusterFlyBounds,
  MIN_SERVER_LICENSE_CLUSTER_COUNT,
  SERVER_CLUSTER_MIN_DRILL_ZOOM,
} from './licenseMapCluster';
import type { MiningLicense } from '../types';

describe('licenseMapCluster', () => {
  describe('resolveLicenseMapGoEnabled', () => {
    it('defaults on when unset', () => {
      expect(resolveLicenseMapGoEnabled(undefined)).toBe(true);
      expect(resolveLicenseMapGoEnabled('')).toBe(true);
    });

    it('opts out only for 0 or false', () => {
      expect(resolveLicenseMapGoEnabled('0')).toBe(false);
      expect(resolveLicenseMapGoEnabled('false')).toBe(false);
      expect(resolveLicenseMapGoEnabled('1')).toBe(true);
      expect(resolveLicenseMapGoEnabled('true')).toBe(true);
    });
  });

  describe('clusterTargetZoom', () => {
    it('increases zoom by 2, capped at 13, floored at drill threshold', () => {
      expect(clusterTargetZoom(5)).toBe(8);
      expect(clusterTargetZoom(8)).toBe(10);
      expect(clusterTargetZoom(12)).toBe(13);
      expect(clusterTargetZoom(14)).toBe(13);
    });

    it('stays at drill threshold or above', () => {
      expect(clusterTargetZoom(2)).toBe(8);
      expect(clusterTargetZoom(2)).toBeGreaterThanOrEqual(SERVER_CLUSTER_MIN_DRILL_ZOOM);
    });
  });

  describe('planClusterDrillFly', () => {
    it('uses center fly for wide continental clusters', () => {
      const plan = planClusterDrillFly(4, 12, 3);
      expect(plan).toEqual({ mode: 'center', zoom: 8 });
    });

    it('uses bounds fly when fit zoom reaches drill threshold', () => {
      const plan = planClusterDrillFly(6, 1.2, 10);
      expect(plan).toEqual({ mode: 'bounds', maxZoom: 10 });
    });
  });

  describe('serverClusterFlyBounds', () => {
    it('pads around grid cell center', () => {
      const item = { mapClusterGridDeg: 4.0, mapClusterCount: 50 } as MiningLicense;
      const box = serverClusterFlyBounds(10, -90, item);
      expect(box.north - box.south).toBeCloseTo(4.4, 1);
      expect(box.east - box.west).toBeCloseTo(4.4, 1);
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
