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

import type { ThemeMode } from "@/lib/theme";

/** Ocean/background colors + English territory label overrides on remote basemap styles. */
export function applyBasemapTuning(map: MaplibreMap, theme: ThemeMode = "dark"): void {
  const colors =
    theme === "light"
      ? { background: "#dce6ef", water: "#b8d4e8" }
      : { background: "#060a12", water: "#0b1322" };
  try {
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", colors.background);
      } else if (layer.type === "fill" && /water|ocean/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-color", colors.water);
      } else if (layer.type === "symbol" && layer.id.startsWith("place_")) {
        map.setLayoutProperty(layer.id, "text-field", placeLabelTextField());
      }
    }
  } catch {
    /* remote style structure may change */
  }
}
