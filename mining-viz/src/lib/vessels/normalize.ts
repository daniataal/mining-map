import type { MaritimeVessel } from './types';

function inferShipTypeLabelFromCode(code: number | null | undefined): string | null {
  if (code == null || !Number.isFinite(code)) return null;
  const c = Math.floor(Number(code));
  if (c >= 80 && c <= 89) return 'Tanker';
  if (c >= 70 && c <= 79) return 'Cargo';
  if (c >= 60 && c <= 69) return 'Passenger';
  if (c > 0) return 'Other';
  return null;
}

/** Ensure API payloads include nested AIS fields even when served from older snapshots. */
export function normalizeMaritimeVessel(raw: MaritimeVessel): MaritimeVessel {
  const trimmedLabel = (raw.ship_type_label || '').trim();
  const inferred = trimmedLabel ? null : inferShipTypeLabelFromCode(raw.ship_type_code ?? null);
  return {
    ...raw,
    ship_type_label: trimmedLabel || inferred || raw.ship_type_label,
    ais_metadata: raw.ais_metadata ?? {},
    ais_messages: raw.ais_messages ?? {},
    message_types_seen: raw.message_types_seen ?? Object.keys(raw.ais_messages ?? {}),
  };
}

export function normalizeMaritimeVessels(vessels: MaritimeVessel[]): MaritimeVessel[] {
  return vessels.map(normalizeMaritimeVessel);
}
