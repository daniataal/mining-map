import type { ExpressionSpecification } from "maplibre-gl";

/** Coalesce numeric MVT / GeoJSON property to a positive number. */
export const coalesceNum = (prop: string, fallback: number): ExpressionSpecification => [
  "max",
  0,
  ["coalesce", ["to-number", ["get", prop]], fallback],
];

/** DWT-based chevron scale below z14 (reference: 80k DWT VLCC). */
export const vesselChevronIconSize: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  ["*", 0.45, ["sqrt", ["/", coalesceNum("dwt", 25000), 80000]]],
  8,
  ["*", 0.65, ["sqrt", ["/", coalesceNum("dwt", 25000), 80000]]],
  12,
  ["*", 0.9, ["sqrt", ["/", coalesceNum("dwt", 25000), 80000]]],
  13.99,
  ["*", 1.05, ["sqrt", ["/", coalesceNum("dwt", 25000), 80000]]],
];

/** True-scale hull icon at z≥14 from LOA (meters) — icon base length ≈32px at z14 ≈150m. */
export const vesselHullIconSize: ExpressionSpecification = [
  "interpolate",
  ["exponential", 2],
  ["zoom"],
  14,
  ["max", 0.55, ["*", ["/", coalesceNum("loa_m", 150), 150], 0.85]],
  16,
  ["max", 0.75, ["*", ["/", coalesceNum("loa_m", 150), 150], 1.35]],
  18,
  ["max", 1.1, ["*", ["/", coalesceNum("loa_m", 150), 150], 2.4]],
];

/** Combined icon-size: chevrons below z14, LOA-scaled hull at z≥14. */
export const vesselIconSize: ExpressionSpecification = [
  "step",
  ["zoom"],
  vesselChevronIconSize,
  14,
  vesselHullIconSize,
];

/** Dot radius scales with DWT when no heading/course. */
export const vesselDotRadius: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  4,
  ["+", 2, ["*", 0.8, ["sqrt", ["/", coalesceNum("dwt", 15000), 50000]]]],
  10,
  ["+", 4, ["*", 1.4, ["sqrt", ["/", coalesceNum("dwt", 15000), 50000]]]],
  14,
  ["+", 5, ["*", 1.8, ["sqrt", ["/", coalesceNum("loa_m", 120), 200]]]],
];

/** Show chevron layers below z14; hull outline layer at z≥14. */
export const zoomBelowTrueScale: ExpressionSpecification = ["<", ["zoom"], 14];
export const zoomAtTrueScale: ExpressionSpecification = [">=", ["zoom"], 14];
