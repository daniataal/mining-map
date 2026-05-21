/** Default Live Data map view — Gulf / Middle East oil hub corridor. */
export const LIVE_DATA_HUB_BBOX = {
  west: 24,
  south: 12,
  east: 55,
  north: 32,
} as const;

export const LIVE_DATA_HUB_CENTER: [number, number] = [
  (LIVE_DATA_HUB_BBOX.south + LIVE_DATA_HUB_BBOX.north) / 2,
  (LIVE_DATA_HUB_BBOX.west + LIVE_DATA_HUB_BBOX.east) / 2,
];

export const LIVE_DATA_HUB_BOUNDS: [[number, number], [number, number]] = [
  [LIVE_DATA_HUB_BBOX.south, LIVE_DATA_HUB_BBOX.west],
  [LIVE_DATA_HUB_BBOX.north, LIVE_DATA_HUB_BBOX.east],
];
