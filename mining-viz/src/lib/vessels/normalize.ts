import type { MaritimeVessel } from './types';

/** Ensure API payloads include nested AIS fields even when served from older snapshots. */
export function normalizeMaritimeVessel(raw: MaritimeVessel): MaritimeVessel {
  return {
    ...raw,
    ais_metadata: raw.ais_metadata ?? {},
    ais_messages: raw.ais_messages ?? {},
    message_types_seen: raw.message_types_seen ?? Object.keys(raw.ais_messages ?? {}),
  };
}

export function normalizeMaritimeVessels(vessels: MaritimeVessel[]): MaritimeVessel[] {
  return vessels.map(normalizeMaritimeVessel);
}
