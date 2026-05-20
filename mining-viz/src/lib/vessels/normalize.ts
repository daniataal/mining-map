import type { MaritimeVessel } from './types';
import { parseAisShipTypeCode } from './filters';

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

/** Ensure API payloads include nested AIS fields even when served from older snapshots. */
export function normalizeMaritimeVessel(raw: MaritimeVessel): MaritimeVessel {
  const trimmedLabel = (raw.ship_type_label || '').trim();
  const parsedCode = parseAisShipTypeCode(raw.ship_type_code);
  const inferred = trimmedLabel ? null : inferShipTypeLabelFromCode(parsedCode);
  return {
    ...raw,
    ship_type_code: parsedCode ?? raw.ship_type_code,
    ship_type_label: trimmedLabel || inferred || raw.ship_type_label,
    ais_metadata: raw.ais_metadata ?? {},
    ais_messages: raw.ais_messages ?? {},
    message_types_seen: raw.message_types_seen ?? Object.keys(raw.ais_messages ?? {}),
  };
}

export function normalizeMaritimeVessels(vessels: MaritimeVessel[]): MaritimeVessel[] {
  return vessels.map(normalizeMaritimeVessel);
}
