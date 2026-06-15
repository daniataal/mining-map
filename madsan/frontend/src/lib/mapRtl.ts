import maplibregl from "maplibre-gl";

/** Self-hosted copy of @mapbox/mapbox-gl-rtl-text (see public/mapbox-gl-rtl-text.js). */
const RTL_PLUGIN_URL = "/mapbox-gl-rtl-text.js";

let initialized = false;

/** Register MapLibre RTL text plugin once (lazy-loads when RTL glyphs appear). */
export function ensureMapRtlPlugin(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  void maplibregl.setRTLTextPlugin(RTL_PLUGIN_URL, true);
}
