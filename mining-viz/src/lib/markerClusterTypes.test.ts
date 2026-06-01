import { describe, expect, it } from 'vitest';
import { asLicenseMarkerClusterGroup } from './markerClusterTypes';

describe('asLicenseMarkerClusterGroup', () => {
  it('accepts the MarkerClusterGroup surface, not only individual cluster bubbles', () => {
    const group = {
      once: () => group,
      off: () => group,
      getVisibleParent: () => null,
      zoomToShowLayer: () => undefined,
    };

    expect(asLicenseMarkerClusterGroup(group)).toBe(group);
  });

  it('rejects an individual cluster bubble without group methods', () => {
    const childCluster = {
      once: () => childCluster,
      off: () => childCluster,
      getAllChildMarkers: () => [],
    };

    expect(asLicenseMarkerClusterGroup(childCluster)).toBeNull();
  });
});
