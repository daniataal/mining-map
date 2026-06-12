import type { ExpressionSpecification, Map as MaplibreMap } from "maplibre-gl";

/** English basemap names replaced for MadSan (OpenMapTiles / OpenFreeMap place layer). */
const REPLACED_ENGLISH_NAMES = [
  "palestinian territories",
  "palestinian territory",
  "palestine",
  "west bank",
  "state of palestine",
] as const;

function englishPlaceLabel(): ExpressionSpecification {
  const raw: ExpressionSpecification = [
    "coalesce",
    ["get", "name_en"],
    ["get", "name:latin"],
    ["get", "name"],
  ];
  return [
    "case",
    ["in", ["downcase", raw], ["literal", [...REPLACED_ENGLISH_NAMES]]],
    "West Bank",
    raw,
  ];
}

/** Bilingual place labels — same structure as OpenFreeMap dark style, with English overrides. */
export function placeLabelTextField(): ExpressionSpecification {
  const latin = englishPlaceLabel();
  return [
    "case",
    ["has", "name:nonlatin"],
    ["concat", latin, "\n", ["get", "name:nonlatin"]],
    latin,
  ];
}

/** Ocean/background colors + English territory label overrides on remote basemap styles. */
export function applyBasemapTuning(map: MaplibreMap): void {
  try {
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#060a12");
      } else if (layer.type === "fill" && /water|ocean/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", "#0b1322");
      } else if (layer.type === "symbol" && layer.id.startsWith("place_")) {
        map.setLayoutProperty(layer.id, "text-field", placeLabelTextField());
      }
    }
  } catch {
    /* remote style structure may change */
  }
}
