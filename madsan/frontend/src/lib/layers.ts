export type LayerDef = {
  id: string;
  label: string;
  vertical: "energy" | "metals" | "shared";
  tileLayer?: string;
  defaultOn: boolean;
};

export const LAYER_REGISTRY: LayerDef[] = [
  { id: "energy-assets", label: "Tank farms & terminals", vertical: "energy", tileLayer: "energy-assets", defaultOn: true },
  { id: "vessels", label: "Vessels / AIS", vertical: "energy", tileLayer: "vessels", defaultOn: true },
  { id: "metals-assets", label: "Mines & smelters", vertical: "metals", tileLayer: "metals-assets", defaultOn: true },
  { id: "pipelines", label: "Pipelines", vertical: "energy", tileLayer: "pipelines", defaultOn: false },
  { id: "prices", label: "Price markers", vertical: "shared", defaultOn: false },
];

export function layersForVertical(vertical: "energy" | "metals"): LayerDef[] {
  return LAYER_REGISTRY.filter((l) => l.vertical === vertical || l.vertical === "shared");
}

export function defaultLayerState(vertical: "energy" | "metals"): Record<string, boolean> {
  return Object.fromEntries(
    LAYER_REGISTRY.map((l) => [l.id, l.defaultOn && (l.vertical === vertical || l.vertical === "shared")])
  );
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088";
