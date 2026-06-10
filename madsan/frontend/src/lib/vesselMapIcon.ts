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

function drawChevronIcon(fill: string, stroke: string, size = 32): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const half = size / 2;
  const pad = 3;
  ctx.translate(half, half);
  ctx.beginPath();
  ctx.moveTo(0, -half + pad);
  ctx.lineTo(half - pad, half - pad);
  ctx.lineTo(0, half * 0.35);
  ctx.lineTo(-half + pad, half - pad);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Elongated hull outline for true-scale display at z≥14 (LOA along vertical axis). */
function drawHullIcon(fill: string, stroke: string, w = 32, h = 64): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  const cx = w / 2;
  const pad = 2;
  ctx.translate(cx, h / 2);
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 + pad);
  ctx.lineTo(w / 2 - pad, h * 0.08);
  ctx.lineTo(w / 2 - pad, h / 2 - pad);
  ctx.lineTo(-(w / 2 - pad), h / 2 - pad);
  ctx.lineTo(-(w / 2 - pad), h * 0.08);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  return ctx.getImageData(0, 0, w, h);
}

export function ensureVesselImages(map: MaplibreMap): void {
  if (!map.hasImage("vessel-ship")) {
    const img = drawChevronIcon("#5eb3ff", "#0a0e14");
    map.addImage("vessel-ship", { width: img.width, height: img.height, data: img.data });
  }
  if (!map.hasImage("vessel-ship-live")) {
    const img = drawChevronIcon("#7ec8ff", "#ffffff");
    map.addImage("vessel-ship-live", { width: img.width, height: img.height, data: img.data });
  }
  if (!map.hasImage("vessel-hull")) {
    const img = drawHullIcon("rgba(94,179,255,0.85)", "#0a0e14");
    map.addImage("vessel-hull", { width: img.width, height: img.height, data: img.data });
  }
  if (!map.hasImage("vessel-hull-live")) {
    const img = drawHullIcon("rgba(126,200,255,0.9)", "#ffffff");
    map.addImage("vessel-hull-live", { width: img.width, height: img.height, data: img.data });
  }
}

export function isVesselLayerId(layerId: string): boolean {
  return (
    layerId === "vessels" ||
    layerId === "live-vessels" ||
    layerId.startsWith("vessels-") ||
    layerId.startsWith("live-vessels")
  );
}
