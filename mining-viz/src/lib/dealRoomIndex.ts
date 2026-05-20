import type { DealRoom } from '../types';

export const DEAL_ROOM_ARCHIVED_STATUS = 'archived';

export function isDealRoomArchived(room: DealRoom): boolean {
  return room.status === DEAL_ROOM_ARCHIVED_STATUS;
}

export function dealRoomEntityKey(entityId: string, entityKind = 'license'): string {
  return `${entityKind}:${entityId}`;
}

/** First active deal room per entity (most recently updated wins when sorted by API). */
export function buildDealRoomByEntityKey(rooms: DealRoom[]): Map<string, DealRoom> {
  const map = new Map<string, DealRoom>();
  for (const room of rooms) {
    if (isDealRoomArchived(room)) continue;
    const key = dealRoomEntityKey(room.entityId, room.entityKind || 'license');
    if (!map.has(key)) map.set(key, room);
  }
  return map;
}

export function getDealRoomForLicense(
  roomsByEntityKey: Map<string, DealRoom>,
  licenseId: string,
  entityKind = 'license',
): DealRoom | undefined {
  return roomsByEntityKey.get(dealRoomEntityKey(licenseId, entityKind));
}
