import type { Polygon } from "geojson";

export type LayerDef = {
  id: string;
  label: string;
  vertical: "energy" | "metals" | "shared";
  tileLayer?: string;
  /** MapLibre source key when multiple toggles share one MVT endpoint */
  tileSourceKey?: string;
  /** MVT feature filter when sharing energy-assets tiles */
  assetTypes?: string[];
  /** GeoJSON overlay fetched from API (not MVT) */
  geoJsonSource?: "sts" | "mcr" | "coverage";
  /** Optional sub-label under the checkbox (e.g. AIS hint, cadastre tier) */
  drawerHint?: string;
  /** Gated by map_premium_layers entitlement */
  premium?: boolean;
  defaultOn: boolean;
  /** Group header in layer drawer (no checkbox) */
  group?: string;
  /** Point color on the map (curated palette) */
  color?: string;
};

/** Vector basemap — free, keyless, dark navy with borders + labels. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/** Curated map palette — keep legend + layer paint in sync. */
export const MAP_COLORS = {
  tankFarm: "#2dd4bf",
  terminal: "#fbbf24",
  refinery: "#fb7185",
  petroleumRight: "#c084fc",
  stsZone: "#c084fc",
  stsEvent: "#e879f9",
  vessel: "#38bdf8",
  mine: "#e8b923",
  smelter: "#fb923c",
  corridorLoad: "#fbbf24",
  corridorDischarge: "#38bdf8",
} as const;

export const LAYER_REGISTRY: LayerDef[] = [
  {
    id: "energy-tank-farms",
    label: "Tank farms & storage",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["tank_farm", "storage"],
    group: "Infrastructure",
    color: MAP_COLORS.tankFarm,
    defaultOn: true,
  },
  {
    id: "energy-terminals",
    label: "Terminals & ports",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["terminal", "port", "berth"],
    group: "Infrastructure",
    color: MAP_COLORS.terminal,
    defaultOn: true,
  },
  {
    id: "energy-refineries",
    label: "Refineries",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["refinery"],
    group: "Infrastructure",
    color: MAP_COLORS.refinery,
    defaultOn: true,
  },
  {
    id: "energy-petroleum-rights",
    label: "Petroleum rights (cadastre)",
    vertical: "energy",
    tileLayer: "energy-cadastre",
    tileSourceKey: "src-energy-cadastre",
    group: "Infrastructure",
    drawerHint: "Government petroleum leases & permits — separate from mining cadastre",
    color: MAP_COLORS.petroleumRight,
    defaultOn: false,
  },
  {
    id: "energy-sts-zones",
    label: "STS anchorages",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["sts_zone"],
    group: "Infrastructure",
    drawerHint: "Known STS zones from legacy import",
    color: MAP_COLORS.stsZone,
    defaultOn: false,
  },
  {
    id: "vessels",
    label: "Vessels / AIS",
    vertical: "energy",
    tileLayer: "vessels",
    group: "Maritime",
    drawerHint: "Live AIS positions (<72h) · dimmer = older fix · Gulf/Hormuz: limited provider coverage",
    defaultOn: true,
  },
  {
    id: "sts-events",
    label: "STS events",
    vertical: "energy",
    geoJsonSource: "sts",
    group: "Maritime",
    drawerHint: "Historic + live AIS proximity STS — click for vessels & inferred product",
    defaultOn: false,
  },
  {
    id: "mcr-corridors",
    label: "MCR voyage corridors",
    vertical: "energy",
    geoJsonSource: "mcr",
    group: "Maritime",
    drawerHint: "Load→discharge arcs from voyages table",
    defaultOn: false,
  },
  {
    id: "ais-coverage",
    label: "AIS coverage overlay",
    vertical: "energy",
    geoJsonSource: "coverage",
    group: "Maritime",
    drawerHint: "Highlights sparse open-AIS regions (Gulf/Hormuz)",
    defaultOn: true,
  },
  {
    id: "metals-mines",
    label: "Mining licenses (cadastre)",
    vertical: "metals",
    tileLayer: "metals-assets",
    tileSourceKey: "src-metals-assets",
    drawerHint: "License polygons — partial country coverage",
    assetTypes: ["mine"],
    color: MAP_COLORS.mine,
    defaultOn: true,
  },
  {
    id: "metals-smelters",
    label: "Smelters & processing plants",
    vertical: "metals",
    tileLayer: "metals-assets",
    tileSourceKey: "src-metals-assets",
    assetTypes: ["smelter", "processing_plant"],
    drawerHint: "Mineral processing licenses — petroleum cadastre is on the energy vertical",
    color: MAP_COLORS.smelter,
    defaultOn: true,
  },
  {
    id: "pipelines",
    label: "Pipelines (petroleum OSM)",
    vertical: "energy",
    tileLayer: "pipelines",
    premium: true,
    group: "Infrastructure",
    drawerHint: "Petroleum pipeline geometry (OSM). Free plan includes this layer when signed in.",
    defaultOn: false,
  },
  {
    id: "prices",
    label: "Price markers",
    vertical: "shared",
    drawerHint: "Deferred — use top ticker; geo price MVT when prices table has locations",
    defaultOn: false,
  },
];

export function layersForVertical(vertical: "energy" | "metals"): LayerDef[] {
  return LAYER_REGISTRY.filter((l) => l.vertical === vertical || l.vertical === "shared");
}

export function defaultLayerState(vertical: "energy" | "metals"): Record<string, boolean> {
  return Object.fromEntries(
    LAYER_REGISTRY.map((l) => [l.id, l.defaultOn && (l.vertical === vertical || l.vertical === "shared")]),
  );
}

/** True when any metals MVT drawer toggle is on (excludes shared non-tile layers). */
export function metalsMapLayersActive(layers: Record<string, boolean>): boolean {
  return layersForVertical("metals")
    .filter((l) => l.tileLayer)
    .some((l) => layers[l.id]);
}

export function mapSourceKey(layer: LayerDef): string {
  return layer.tileSourceKey ?? `src-${layer.id}`;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088";

/** Persian Gulf / Hormuz / Gulf of Oman — sparse open AIS provider coverage. */
export const PERSIAN_GULF_AIS_BBOX = {
  west: 47,
  south: 22,
  east: 60,
  north: 30.5,
} as const;

/** GeoJSON polygon for AIS coverage gap overlay */
export const PERSIAN_GULF_COVERAGE_POLYGON: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [PERSIAN_GULF_AIS_BBOX.west, PERSIAN_GULF_AIS_BBOX.south],
      [PERSIAN_GULF_AIS_BBOX.east, PERSIAN_GULF_AIS_BBOX.south],
      [PERSIAN_GULF_AIS_BBOX.east, PERSIAN_GULF_AIS_BBOX.north],
      [PERSIAN_GULF_AIS_BBOX.west, PERSIAN_GULF_AIS_BBOX.north],
      [PERSIAN_GULF_AIS_BBOX.west, PERSIAN_GULF_AIS_BBOX.south],
    ],
  ],
};

export const LIMITED_AIS_COVERAGE_LABEL = "Limited provider coverage";

export const LIMITED_AIS_COVERAGE_DETAIL =
  "Open AIS (AISStream) is sparse in the Persian Gulf, Strait of Hormuz, and Gulf of Oman. An empty map is not proof of no traffic.";

export function viewportOverlapsPersianGulf(viewport: {
  west: number;
  south: number;
  east: number;
  north: number;
}): boolean {
  const h = PERSIAN_GULF_AIS_BBOX;
  return !(
    viewport.north < h.south ||
    viewport.south > h.north ||
    viewport.east < h.west ||
    viewport.west > h.east
  );
}

export function isPointInPersianGulf(lat: number, lng: number): boolean {
  const h = PERSIAN_GULF_AIS_BBOX;
  return lat >= h.south && lat <= h.north && lng >= h.west && lng <= h.east;
}
