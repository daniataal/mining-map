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
  geoJsonSource?: "sts" | "sts-predictions" | "mcr" | "storage" | "asset-geometries";
  /** Optional sub-label under the checkbox (e.g. AIS hint, cadastre tier) */
  drawerHint?: string;
  /** Gated by map_premium_layers entitlement */
  premium?: boolean;
  defaultOn: boolean;
  /** Group header in layer drawer (no checkbox) */
  group?: string;
  /** When set, row is controlled by a master group toggle (see LAYER_GROUPS) */
  layerGroup?: string;
  /** Hide individual row — only the group master is shown */
  hideInDrawer?: boolean;
  /** Point color on the map (curated palette) */
  color?: string;
};

/** Vector basemap — free, keyless OpenFreeMap styles. */
export const MAP_STYLE_URL_DARK = "https://tiles.openfreemap.org/styles/dark";
export const MAP_STYLE_URL_LIGHT = "https://tiles.openfreemap.org/styles/liberty";

/** @deprecated use mapStyleForTheme */
export const MAP_STYLE_URL = MAP_STYLE_URL_DARK;

export function mapStyleForTheme(theme: "light" | "dark"): string {
  return theme === "light" ? MAP_STYLE_URL_LIGHT : MAP_STYLE_URL_DARK;
}

/** Curated map palette — keep legend + layer paint in sync. */
export const MAP_COLORS = {
  tankFarm: "#2dd4bf",
  terminal: "#fbbf24",
  refinery: "#fb7185",
  petroleumRight: "#c084fc",
  stsZone: "#c084fc",
  stsEvent: "#e879f9",
  stsPrediction: "#22d3ee",
  storageSite: "#34d399",
  gemRoute: "#5dffc8",
  vessel: "#38bdf8",
  mine: "#e8b923",
  smelter: "#fb923c",
  corridorLoad: "#fbbf24",
  corridorDischarge: "#38bdf8",
} as const;

/** Master toggles that drive several sub-layers with distinct colors on the map. */
export type LayerGroupDef = {
  id: string;
  label: string;
  group: string;
  memberIds: string[];
  /** Swatches shown on the single row (legend for sub-layers) */
  swatches: { label: string; color: string }[];
  drawerHint?: string;
  defaultOn: boolean;
};

export const LAYER_GROUPS: LayerGroupDef[] = [
  {
    id: "storage-tanks",
    label: "Storage & tank farms",
    group: "Infrastructure",
    memberIds: ["energy-tank-farms", "storage-sites"],
    swatches: [
      { label: "OSM tank points", color: MAP_COLORS.tankFarm },
      { label: "Inventory estimate", color: MAP_COLORS.storageSite },
    ],
    drawerHint: "Teal = individual OSM tanks · Green = clustered sites with bounded fill estimate (not measured inventory)",
    defaultOn: false,
  },
  {
    id: "sts-intelligence",
    label: "STS intelligence",
    group: "Maritime",
    memberIds: ["energy-sts-zones", "sts-events", "sts-predictions"],
    swatches: [
      { label: "Anchorages", color: MAP_COLORS.stsZone },
      { label: "Historic/live events", color: MAP_COLORS.stsEvent },
      { label: "Predictions", color: MAP_COLORS.stsPrediction },
    ],
    drawerHint: "Purple = known STS zones · Pink = scored past/live transfers · Cyan = likely upcoming pair",
    defaultOn: false,
  },
];

export const LAYER_REGISTRY: LayerDef[] = [
  {
    id: "energy-tank-farms",
    label: "Tank farms & storage",
    vertical: "energy",
    tileLayer: "energy-assets",
    tileSourceKey: "src-energy-assets",
    assetTypes: ["tank_farm", "storage"],
    group: "Infrastructure",
    layerGroup: "storage-tanks",
    hideInDrawer: true,
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
    id: "storage-sites",
    label: "Storage inventory (est.)",
    vertical: "energy",
    geoJsonSource: "storage",
    group: "Infrastructure",
    layerGroup: "storage-tanks",
    hideInDrawer: true,
    drawerHint: "Tank sites clustered from OSM with bounded capacity & fill estimates (OSM density × EIA utilization band) — estimates, not measurements",
    color: MAP_COLORS.storageSite,
    defaultOn: false,
  },
  {
    id: "gem-asset-geometries",
    label: "GEM oil/gas/LNG routes",
    vertical: "energy",
    geoJsonSource: "asset-geometries",
    group: "Infrastructure",
    drawerHint: "BBox-filtered PostGIS geometries from GEM oil/NGL pipelines, gas pipelines, and LNG terminals",
    color: MAP_COLORS.gemRoute,
    defaultOn: false,
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
    layerGroup: "sts-intelligence",
    hideInDrawer: true,
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
    drawerHint: "Live overlay (<12h, WS) · dimmer tiles = last known fix (<72h) · Gulf/Hormuz: sparse AISStream coverage",
    defaultOn: true,
  },
  {
    id: "sts-events",
    label: "STS events",
    vertical: "energy",
    geoJsonSource: "sts",
    group: "Maritime",
    layerGroup: "sts-intelligence",
    hideInDrawer: true,
    drawerHint: "Historic + live STS transfer probability — low-confidence port co-proximity hidden",
    defaultOn: false,
  },
  {
    id: "sts-predictions",
    label: "STS predictions",
    vertical: "energy",
    geoJsonSource: "sts-predictions",
    group: "Maritime",
    layerGroup: "sts-intelligence",
    hideInDrawer: true,
    drawerHint: "Likely vessel-pair STS predictions plotted at recent AIS pair midpoint",
    color: MAP_COLORS.stsPrediction,
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

export function layerGroupsForVertical(vertical: "energy" | "metals"): LayerGroupDef[] {
  if (vertical !== "energy") return [];
  return LAYER_GROUPS;
}

export function isLayerGroupOn(group: LayerGroupDef, layers: Record<string, boolean>): boolean {
  return group.memberIds.some((id) => layers[id]);
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

export const LIMITED_AIS_COVERAGE_LABEL = "Limited provider coverage";

export const LIMITED_AIS_COVERAGE_DETAIL =
  "Open AIS (AISStream) is sparse in the Persian Gulf, Strait of Hormuz, and Gulf of Oman. An empty map is not proof of no traffic.";

export function isPointInPersianGulf(lat: number, lng: number): boolean {
  const h = PERSIAN_GULF_AIS_BBOX;
  return lat >= h.south && lat <= h.north && lng >= h.west && lng <= h.east;
}
