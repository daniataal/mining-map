import type { Feature, Point } from "geojson";
import { decode } from "@msgpack/msgpack";

export type VesselMsg = {
  mmsi: string;
  name?: string;
  vessel_type?: string;
  lat: number;
  lon: number;
  course?: number;
  heading?: number;
  inferred_course?: number;
  speed_knots?: number;
  destination?: string;
  last_seen_at?: string;
  source?: string;
};

export type BBox = [west: number, south: number, east: number, north: number];

const KNOTS_TO_MPS = 0.514444;
const EARTH_RADIUS_M = 6371000;
const MAX_EXTRAPOLATION_MS = 60_000;
/** Do not animate dead reckoning beyond live AIS window (matches backend LivePositionMaxAge). */
const MAX_LIVE_POSITION_MS = 12 * 60 * 60 * 1000;
const MIN_SPEED_KNOTS = 0.1;
const MIN_TRACK_SEGMENT_M = 80;
const VIEWPORT_BUFFER_DEG = 0.15;

type VesselState = VesselMsg & { observedAtMs: number };

export function isValidHeading(
  h: number | null | undefined,
  speedKnots?: number | null,
): boolean {
  if (h == null || h < 0 || h >= 360 || h === 511) return false;
  const speed = speedKnots ?? 0;
  if (h === 0 && speed < MIN_SPEED_KNOTS) return false;
  return true;
}

export function isValidInferredCourse(c: number | null | undefined): boolean {
  return c != null && c >= 0 && c < 360;
}

/** Great-circle initial bearing (0=north, clockwise). */
export function bearingFromDelta(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isValidCourse(
  c: number | null | undefined,
  speedKnots?: number | null,
): boolean {
  if (c == null || c < 0 || c >= 360) return false;
  if (speedKnots != null && speedKnots < MIN_SPEED_KNOTS) return false;
  return true;
}

/** Prefer COG when moving; otherwise true heading; else track-inferred bearing. */
export function vesselBearing(
  v: Pick<VesselMsg, "course" | "heading" | "inferred_course" | "speed_knots">,
): number | null {
  const speed = v.speed_knots ?? 0;
  if (isValidCourse(v.course, speed)) return v.course!;
  if (isValidHeading(v.heading, speed)) return v.heading!;
  if (isValidInferredCourse(v.inferred_course)) return v.inferred_course!;
  return null;
}

export function canDeadReckon(v: Pick<VesselMsg, "speed_knots" | "course" | "heading">): boolean {
  const speed = v.speed_knots;
  if (speed == null || speed < MIN_SPEED_KNOTS) return false;
  return vesselBearing(v) != null;
}

export function parseObservedAtMs(last_seen_at?: string): number {
  if (!last_seen_at) return Date.now();
  const t = Date.parse(last_seen_at);
  return Number.isFinite(t) ? t : Date.now();
}

export function aisAgeHours(last_seen_at?: string, now = Date.now()): number {
  const observedAtMs = parseObservedAtMs(last_seen_at);
  return Math.max(0, (now - observedAtMs) / (60 * 60 * 1000));
}

export function isLivePosition(last_seen_at?: string, now = Date.now()): boolean {
  const observedAtMs = parseObservedAtMs(last_seen_at);
  return now - observedAtMs <= MAX_LIVE_POSITION_MS;
}

export function deadReckonPosition(
  lat: number,
  lon: number,
  bearingDeg: number,
  speedKnots: number,
  elapsedMs: number,
): { lat: number; lon: number } {
  const elapsedSec = Math.min(Math.max(elapsedMs, 0), MAX_EXTRAPOLATION_MS) / 1000;
  const distM = speedKnots * KNOTS_TO_MPS * elapsedSec;
  if (distM <= 0) return { lat, lon };

  const brng = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = distM / EARTH_RADIUS_M;

  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(brng));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(brng) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

  return {
    lat: (φ2 * 180) / Math.PI,
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

export function isInBbox(lat: number, lon: number, bbox: BBox, bufferDeg = VIEWPORT_BUFFER_DEG): boolean {
  const [west, south, east, north] = bbox;
  return lat >= south - bufferDeg && lat <= north + bufferDeg && lon >= west - bufferDeg && lon <= east + bufferDeg;
}

export function toVesselFeature(v: VesselMsg, lat = v.lat, lon = v.lon, now = Date.now()): Feature<Point> {
  const ageH = aisAgeHours(v.last_seen_at, now);
  return {
    type: "Feature",
    id: v.mmsi,
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      mmsi: v.mmsi,
      name: v.name ?? "",
      vessel_type: v.vessel_type ?? "",
      course: v.course ?? null,
      heading: v.heading ?? null,
      inferred_course: v.inferred_course ?? null,
      speed_knots: v.speed_knots ?? null,
      last_seen_at: v.last_seen_at ?? "",
      ais_age_h: ageH,
      source: v.source ?? "live",
    },
  };
}

type ControllerOpts = {
  getBbox: () => BBox;
  onFeatures: (features: Feature<Point>[]) => void;
};

/** One animated position per MMSI; RAF coalesced; viewport-only motion. */
export class VesselDeadReckoning {
  private vessels = new Map<string, VesselState>();
  private rafId: number | null = null;
  private readonly getBbox: () => BBox;
  private readonly onFeatures: (features: Feature<Point>[]) => void;

  constructor(opts: ControllerOpts) {
    this.getBbox = opts.getBbox;
    this.onFeatures = opts.onFeatures;
  }

  dispose(): void {
    this.stopLoop();
    this.vessels.clear();
  }

  clear(): void {
    this.vessels.clear();
    this.onFeatures([]);
    this.stopLoop();
  }

  private enrich(msg: VesselMsg, prev?: VesselState): VesselState {
    const observedAtMs = parseObservedAtMs(msg.last_seen_at);
    let inferred = msg.inferred_course;
    if (!isValidInferredCourse(inferred) && prev) {
      const dist = haversineM(prev.lat, prev.lon, msg.lat, msg.lon);
      if (dist >= MIN_TRACK_SEGMENT_M) {
        inferred = bearingFromDelta(prev.lat, prev.lon, msg.lat, msg.lon);
      }
    }
    return {
      ...msg,
      inferred_course: isValidInferredCourse(inferred) ? inferred : undefined,
      observedAtMs,
    };
  }

  /** Drop stale WS/MVT frames by observed timestamp. */
  upsert(msg: VesselMsg): void {
    const prev = this.vessels.get(msg.mmsi);
    const observedAtMs = parseObservedAtMs(msg.last_seen_at);
    if (prev && observedAtMs < prev.observedAtMs) return;
    this.vessels.set(msg.mmsi, this.enrich(msg, prev));
    this.publishAndMaybeAnimate();
  }

  replaceAll(msgs: VesselMsg[]): void {
    this.vessels.clear();
    for (const msg of msgs) {
      this.vessels.set(msg.mmsi, this.enrich(msg));
    }
    this.publishAndMaybeAnimate();
  }

  viewportChanged(): void {
    this.publishAndMaybeAnimate();
  }

  private hasAnimatableInViewport(now = Date.now()): boolean {
    const bbox = this.getBbox();
    for (const v of this.vessels.values()) {
      if (!canDeadReckon(v) || !isInBbox(v.lat, v.lon, bbox)) continue;
      const elapsed = now - v.observedAtMs;
      if (elapsed > 0 && elapsed <= MAX_EXTRAPOLATION_MS && isLivePosition(v.last_seen_at, now)) return true;
    }
    return false;
  }

  private buildFeatures(now = Date.now()): Feature<Point>[] {
    const bbox = this.getBbox();
    const features: Feature<Point>[] = [];
    for (const v of this.vessels.values()) {
      let lat = v.lat;
      let lon = v.lon;
      const bearing = vesselBearing(v);
      if (canDeadReckon(v) && bearing != null && isInBbox(lat, lon, bbox)) {
        const elapsed = now - v.observedAtMs;
        if (elapsed > 0 && elapsed <= MAX_EXTRAPOLATION_MS && isLivePosition(v.last_seen_at, now)) {
          ({ lat, lon } = deadReckonPosition(lat, lon, bearing, v.speed_knots!, elapsed));
        }
      }
      features.push(toVesselFeature(v, lat, lon));
    }
    return features;
  }

  private publishAndMaybeAnimate(): void {
    this.onFeatures(this.buildFeatures());
    if (this.hasAnimatableInViewport()) {
      this.scheduleFrame();
    } else {
      this.stopLoop();
    }
  }

  private tick = (): void => {
    this.rafId = null;
    this.onFeatures(this.buildFeatures());
    if (this.hasAnimatableInViewport()) {
      this.scheduleFrame();
    }
  };

  private scheduleFrame(): void {
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

export type WsFrame = {
  type?: string;
  vessels?: VesselMsg[];
  data?: VesselMsg;
  entity?: string;
};

function normalizeLastSeen(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

/** Go msgpack uses struct field names (MMSI, Lat); JSON uses json tags (mmsi, lat). */
function normalizeVessel(raw: Record<string, unknown>): VesselMsg {
  const num = (lower: string, upper: string): number | undefined => {
    const v = raw[lower] ?? raw[upper];
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const str = (lower: string, upper: string): string | undefined => {
    const v = raw[lower] ?? raw[upper];
    return v == null ? undefined : String(v);
  };
  return {
    mmsi: str("mmsi", "MMSI") ?? "",
    name: str("name", "Name"),
    vessel_type: str("vessel_type", "VesselType"),
    lat: num("lat", "Lat") ?? 0,
    lon: num("lon", "Lon") ?? 0,
    course: num("course", "Course"),
    heading: num("heading", "Heading"),
    inferred_course: num("inferred_course", "InferredCourse"),
    speed_knots: num("speed_knots", "SpeedKnots"),
    destination: str("destination", "Destination"),
    last_seen_at: normalizeLastSeen(raw.last_seen_at ?? raw.LastSeenAt),
    source: str("source", "Source"),
  };
}

export function parseWsFrame(data: string | ArrayBuffer): WsFrame | null {
  try {
    if (typeof data === "string") {
      return JSON.parse(data) as WsFrame;
    }
    const msg = decode(new Uint8Array(data)) as WsFrame;
    if (Array.isArray(msg.vessels)) {
      msg.vessels = msg.vessels.map((v) => normalizeVessel(v as Record<string, unknown>));
    }
    if (msg.data) {
      msg.data = normalizeVessel(msg.data as Record<string, unknown>);
    }
    return msg;
  } catch {
    return null;
  }
}
