export type LayerDef = {
  id: string;
  label: string;
  vertical: "energy" | "metals" | "shared";
  tileLayer?: string;
  /** MapLibre source key when multiple toggles share one MVT endpoint */
  tileSourceKey?: string;
  /** Optional sub-label under the checkbox (e.g. AIS hint, cadastre tier) */
  drawerHint?: string;
  /** Gated by map_premium_layers entitlement */
  premium?: boolean;
  defaultOn: boolean;
};

export const LAYER_REGISTRY: LayerDef[] = [
  { id: "energy-assets", label: "Tank farms & terminals", vertical: "energy", tileLayer: "energy-assets", defaultOn: true },
  { id: "vessels", label: "Vessels / AIS", vertical: "energy", tileLayer: "vessels", drawerHint: "Chevron = AIS course/heading · Gulf/Hormuz: limited provider coverage", defaultOn: true },
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
    LAYER_REGISTRY.map((l) => [l.id, l.defaultOn && (l.vertical === vertical || l.vertical === "shared")])
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
