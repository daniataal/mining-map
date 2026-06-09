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
  { id: "metals-assets", label: "Mines & smelters", vertical: "metals", tileLayer: "metals-assets", defaultOn: false },
  { id: "pipelines", label: "Pipelines", vertical: "energy", defaultOn: false },
  { id: "prices", label: "Price markers", vertical: "shared", defaultOn: false },
];

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8088";
