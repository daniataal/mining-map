import type { MaritimeVesselFeedResponse } from './types';

let snapshot: MaritimeVesselFeedResponse | null = null;

export function readMaritimeSnapshotCache(): MaritimeVesselFeedResponse | null {
  return snapshot;
}

export function writeMaritimeSnapshotCache(feed: MaritimeVesselFeedResponse | null): void {
  snapshot = feed;
}

export function clearMaritimeSnapshotCache(): void {
  snapshot = null;
}
