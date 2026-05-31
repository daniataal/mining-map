import type { MaritimeVessel } from './types';
import { parseAisShipTypeCode } from './filters';

type RawMaritimeVessel = MaritimeVessel & Record<string, unknown>;

function inferShipTypeLabelFromCode(code: unknown): string | null {
  const parsed = parseAisShipTypeCode(code);
  if (parsed == null) return null;
  const c = parsed;
  if (c >= 80 && c <= 89) return 'Tanker';
  if (c >= 70 && c <= 79) return 'Cargo';
  if (c >= 60 && c <= 69) return 'Passenger';
  if (c > 0) return 'Other';
  return null;
}

function asMmsiString(value: unknown): string {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function pickObservedAt(raw: RawMaritimeVessel): string {
  return pickString(raw.observed_at, raw.position_time, raw.ts, raw.last_seen_at, raw.last_message_at);
}

function pickSpeedKnots(raw: RawMaritimeVessel): number | null | undefined {
  if (raw.speed_knots != null) return raw.speed_knots;
  if (raw.speed != null) return raw.speed as number;
  if (raw.sog != null) return raw.sog as number;
  return raw.speed_knots;
}

function pickCourse(raw: RawMaritimeVessel): number | null | undefined {
  if (raw.course_over_ground != null) return raw.course_over_ground;
  if (raw.course != null) return raw.course as number;
  if (raw.cog != null) return raw.cog as number;
  return raw.course_over_ground;
}

function pickVesselName(raw: RawMaritimeVessel, mmsi: string): string {
  const name = pickString(raw.vessel_name, raw.name);
  return name || (mmsi ? `MMSI ${mmsi}` : 'Unknown vessel');
}

function pickVesselId(raw: RawMaritimeVessel, mmsi: string): string {
  const explicit = pickString(raw.id);
  if (explicit) return explicit;
  if (mmsi) return `mmsi:${mmsi}`;
  return 'vessel:unknown';
}

/** Ensure API payloads match the frontend vessel contract (Go live feed + legacy snapshots). */
export function normalizeMaritimeVessel(raw: MaritimeVessel): MaritimeVessel {
  const source = raw as RawMaritimeVessel;
  const mmsi = asMmsiString(source.mmsi);
  const trimmedLabel = (source.ship_type_label || '').trim();
  const parsedCode = parseAisShipTypeCode(source.ship_type_code);
  const inferred = trimmedLabel ? null : inferShipTypeLabelFromCode(parsedCode);
  return {
    ...source,
    id: pickVesselId(source, mmsi),
    mmsi,
    vessel_name: pickVesselName(source, mmsi),
    observed_at: pickObservedAt(source),
    speed_knots: pickSpeedKnots(source),
    course_over_ground: pickCourse(source),
    source_label: pickString(source.source_label, source.source, 'AIS'),
    ship_type_code: parsedCode ?? source.ship_type_code,
    ship_type_label: trimmedLabel || inferred || source.ship_type_label,
    ais_metadata: source.ais_metadata ?? {},
    ais_messages: source.ais_messages ?? {},
    message_types_seen: source.message_types_seen ?? Object.keys(source.ais_messages ?? {}),
  };
}

export function normalizeMaritimeVessels(vessels: MaritimeVessel[]): MaritimeVessel[] {
  return vessels.map(normalizeMaritimeVessel);
}
