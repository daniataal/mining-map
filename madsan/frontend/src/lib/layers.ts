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
};

export const LAYER_REGISTRY: LayerDef[] = [
  {
    id: "energy-tank-farms",
    label: "Tank farms & storage",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["tank_farm", "storage"],
    group: "Infrastructure",
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
    defaultOn: true,
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
    defaultOn: false,
  },
  {
    id: "vessels",
    label: "Vessels / AIS",
    vertical: "energy",
    tileLayer: "vessels",
    group: "Maritime",
    drawerHint: "DWT/LOA-scaled icons · Gulf/Hormuz: limited provider coverage",
    defaultOn: true,
  },
  {
    id: "sts-events",
    label: "STS events",
    vertical: "energy",
    geoJsonSource: "sts",
    group: "Maritime",
    drawerHint: "Proximity events — fills after STS migration",
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
    defaultOn: true,
  },
  {
    id: "metals-smelters",
    label: "Smelters & plants",
    vertical: "metals",
    tileLayer: "metals-assets",
    tileSourceKey: "src-metals-assets",
    defaultOn: true,
  },
  {
    id: "pipelines",
    label: "Pipelines (petroleum OSM)",
    vertical: "energy",
    tileLayer: "pipelines",
    premium: true,
    group: "Infrastructure",
    drawerHint: "Premium layer — requires plan entitlement",
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
