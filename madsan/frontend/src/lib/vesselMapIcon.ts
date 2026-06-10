import type { ExpressionSpecification } from "maplibre-gl";
import type { Map as MaplibreMap } from "maplibre-gl";

/** AIS course over ground present and usable (0–360°). */
export const vesselHasCourseFilter = [
  "all",
  ["has", "course"],
  [">=", ["to-number", ["get", "course"]], 0],
  ["<", ["to-number", ["get", "course"]], 360],
] as ExpressionSpecification;

/** True heading when reported; 511 is the AIS invalid sentinel. */
export const vesselHasHeadingFilter = [
  "all",
  ["has", "heading"],
  [">=", ["to-number", ["get", "heading"]], 0],
  ["<", ["to-number", ["get", "heading"]], 360],
  ["!=", ["to-number", ["get", "heading"]], 511],
] as ExpressionSpecification;

/** Ship chevron when course or heading is available (legacy prefers true heading). */
export const vesselHasRotationFilter = ["any", vesselHasHeadingFilter, vesselHasCourseFilter] as ExpressionSpecification;

/** Position-only tier: no reported course/heading — render as dot, not ship chevron. */
export const vesselNoRotationFilter = ["!", vesselHasRotationFilter] as ExpressionSpecification;

export const vesselIconRotate = [
  "case",
  vesselHasHeadingFilter,
  ["to-number", ["get", "heading"]],
  vesselHasCourseFilter,
  ["to-number", ["get", "course"]],
  0,
] as ExpressionSpecification;

/** Icons are rasterized at 2x and registered with pixelRatio 2 for crisp edges. */
const ICON_DPR = 2;

/**
 * MarineTraffic-style direction arrow (mid zoom): slim, sharp tip, concave tail.
 * Logical 24×32; pointing up (rotated by icon-rotate).
 */
function drawArrowIcon(fill: string, stroke: string): ImageData {
  const w = 24 * ICON_DPR;
  const h = 32 * ICON_DPR;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const cx = w / 2;
  const pad = 2 * ICON_DPR;
  ctx.beginPath();
  ctx.moveTo(cx, pad); // bow tip
  ctx.lineTo(w - pad, h - pad); // tail right
  ctx.lineTo(cx, h - h * 0.28); // concave notch
  ctx.lineTo(pad, h - pad); // tail left
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5 * ICON_DPR;
  ctx.lineJoin = "round";
  ctx.stroke();
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Ship silhouette for true-scale display at z≥14: pointed bow, curved shoulders,
 * parallel sides, flat stern — LOA along the vertical axis. Logical 28×72.
 */
function drawShipIcon(fill: string, stroke: string): ImageData {
  const w = 28 * ICON_DPR;
  const h = 72 * ICON_DPR;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const pad = 1.5 * ICON_DPR;
  const cx = w / 2;
  const right = w - pad;
  const left = pad;
  const shoulderY = h * 0.3; // where the bow taper reaches full beam
  const sternY = h - pad;
  ctx.beginPath();
  ctx.moveTo(cx, pad); // bow tip
  ctx.quadraticCurveTo(right, shoulderY * 0.55, right, shoulderY); // starboard bow curve
  ctx.lineTo(right, sternY - 3 * ICON_DPR);
  ctx.quadraticCurveTo(right, sternY, right - 3 * ICON_DPR, sternY); // stern corner
  ctx.lineTo(left + 3 * ICON_DPR, sternY);
  ctx.quadraticCurveTo(left, sternY, left, sternY - 3 * ICON_DPR);
  ctx.lineTo(left, shoulderY);
  ctx.quadraticCurveTo(left, shoulderY * 0.55, cx, pad); // port bow curve
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.25 * ICON_DPR;
  ctx.lineJoin = "round";
  ctx.stroke();
  // Bridge block near the stern (subtle MarineTraffic-style deck hint).
  ctx.fillStyle = stroke;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(left + 4 * ICON_DPR, h * 0.78, w - 8 * ICON_DPR, h * 0.1);
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

function addIcon(map: MaplibreMap, id: string, img: ImageData): void {
  if (map.hasImage(id)) return;
  map.addImage(
    id,
    { width: img.width, height: img.height, data: img.data },
    { pixelRatio: ICON_DPR },
  );
}

export function ensureVesselImages(map: MaplibreMap): void {
  addIcon(map, "vessel-ship", drawArrowIcon("#38bdf8", "#06121f"));
  addIcon(map, "vessel-ship-live", drawArrowIcon("#7dd3fc", "#0b2536"));
  addIcon(map, "vessel-hull", drawShipIcon("rgba(56,189,248,0.92)", "#06121f"));
  addIcon(map, "vessel-hull-live", drawShipIcon("rgba(125,211,252,0.95)", "#0b2536"));
}

export function isVesselLayerId(layerId: string): boolean {
  return (
    layerId === "vessels" ||
    layerId === "live-vessels" ||
    layerId.startsWith("vessels-") ||
    layerId.startsWith("live-vessels")
  );
}
