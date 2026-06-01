import { describe, expect, it } from 'vitest';
import {
  clusterTargetZoom,
  clusterExpandPaddingDeg,
  collapseServerClustersInViewport,
  applyServerClusterDisplayPositions,
  filterLicenseMapRowsToBounds,
  pickDominantClusterCenter,
  snapClusterBubblePosition,
  planClusterDrillFly,
  resolveLicenseMapGoEnabled,
  shouldRenderServerLicenseCluster,
  serverClusterFlyBounds,
  MAX_VIEWPORT_CLUSTER_MERGE_TOTAL,
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

  describe('filterLicenseMapRowsToBounds', () => {
    const bounds = { south: 5, west: -2, north: 9, east: 0 };

    it('drops clusters outside the visible bbox', () => {
      const inside = {
        id: 'cluster:gh:6:-1',
        licenseType: 'Cluster',
        mapClusterCount: 40,
        lat: 6,
        lng: -1,
      } as MiningLicense;
      const outside = {
        id: 'cluster:ci:8:-5',
        licenseType: 'Cluster',
        mapClusterCount: 66,
        lat: 8,
        lng: -5,
      } as MiningLicense;
      expect(filterLicenseMapRowsToBounds([inside, outside], bounds)).toEqual([inside]);
    });
  });

  describe('collapseServerClustersInViewport', () => {
    const viewport = { south: 5, west: -2, north: 9, east: 0 };

    const cluster = (lat: number, lng: number, count: number, country = 'Ghana'): MiningLicense =>
      ({
        id: `cluster:${country}:${lat}:${lng}`,
        licenseType: 'Cluster',
        mapClusterCount: count,
        mapClusterGridDeg: 8,
        lat,
        lng,
        country,
        sector: 'mining',
      }) as MiningLicense;

    it('does not merge when in-viewport total exceeds cap', () => {
      const rows = [
        cluster(6, -1, 250),
        cluster(7, -0.5, 250),
      ];
      const out = collapseServerClustersInViewport(rows, viewport, 6);
      expect(out.filter((r) => r.licenseType === 'Cluster')).toHaveLength(2);
      expect(
        out.reduce((sum, r) => sum + (r.mapClusterCount ?? 0), 0),
      ).toBeGreaterThan(MAX_VIEWPORT_CLUSTER_MERGE_TOTAL);
    });

    it('merges only in-viewport clusters for tight regional bbox', () => {
      const rows = [
        cluster(6, -1, 120),
        cluster(7, -0.5, 80),
        cluster(8, -5, 66, 'Côte d\'Ivoire'),
      ];
      const out = collapseServerClustersInViewport(rows, viewport, 6);
      const clusters = out.filter((r) => r.licenseType === 'Cluster');
      expect(clusters).toHaveLength(1);
      expect(clusters[0].mapClusterCount).toBe(200);
      // Dominant interior-ish cell snaps to viewport center when on padded edge.
      expect(clusters[0].lat).toBe(7);
      expect(clusters[0].lng).toBe(-1);
    });
  });

  describe('pickDominantClusterCenter', () => {
    it('returns largest cell center not weighted average', () => {
      const center = pickDominantClusterCenter([
        { lat: 3, lng: 3, mapClusterCount: 10 },
        { lat: 9, lng: 3, mapClusterCount: 20 },
      ]);
      expect(center).toEqual({ lat: 9, lng: 3 });
    });
  });

  describe('snapClusterBubblePosition', () => {
    const ghanaBounds = { south: 4, west: -4, north: 12, east: 2 };

    it('keeps interior grid centers', () => {
      expect(snapClusterBubblePosition(7, -1, ghanaBounds, 8)).toEqual({ lat: 7, lng: -1 });
    });

    it('snaps global-grid offshore centers to viewport center', () => {
      expect(snapClusterBubblePosition(4, -4, ghanaBounds, 8)).toEqual({ lat: 8, lng: -1 });
    });
  });

  describe('applyServerClusterDisplayPositions', () => {
    /** West Africa regional viewport at zoom 6–7 (includes Gulf of Guinea). */
    const westAfricaViewport = { south: 0, west: -20, north: 16, east: 10 };

    it('snaps Gulf offshore Ghana cluster onto land at regional zoom', () => {
      const rows = [
        {
          id: 'cluster:gh:4:0',
          licenseType: 'Cluster',
          mapClusterCount: 1129,
          mapClusterGridDeg: 8,
          lat: 4,
          lng: 0,
          country: 'Ghana',
        } as MiningLicense,
      ];
      const out = applyServerClusterDisplayPositions(rows, westAfricaViewport, 6);
      expect(out[0].lat).toBeCloseTo(8, 0);
      expect(out[0].lng).toBeCloseTo(-1, 0);
      expect(out[0]._displayLat).toBe(out[0].lat);
    });

    it('snaps edge-aligned global-grid centers onto Ghana land', () => {
      const rows = [
        {
          id: 'cluster:gh:4:-4',
          licenseType: 'Cluster',
          mapClusterCount: 1129,
          mapClusterGridDeg: 8,
          lat: 4,
          lng: -4,
          country: 'Ghana',
        } as MiningLicense,
      ];
      const out = applyServerClusterDisplayPositions(
        rows,
        { south: 4, west: -4, north: 12, east: 2 },
        6,
      );
      expect(out[0].lat).toBe(8);
      expect(out[0].lng).toBe(-1);
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
