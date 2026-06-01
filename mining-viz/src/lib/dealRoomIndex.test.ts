import { describe, expect, it } from 'vitest';
import { buildDealRoomByEntityKey, dealRoomEntityKey, getDealRoomForLicense } from './dealRoomIndex';
import type { DealRoom } from '../types';

function room(id: string, entityId: string, entityKind = 'license'): DealRoom {
  return {
    id,
    title: `Room ${id}`,
    entityId,
    entityKind,
    status: 'open',
    agentJobIds: [],
  };
}

describe('dealRoomIndex', () => {
  it('builds entity key map', () => {
    const map = buildDealRoomByEntityKey([
      room('a', 'lic-1'),
      room('b', 'lic-2', 'license'),
    ]);
    expect(map.get(dealRoomEntityKey('lic-1'))?.id).toBe('a');
    expect(getDealRoomForLicense(map, 'lic-2')?.id).toBe('b');
    expect(getDealRoomForLicense(map, 'missing')).toBeUndefined();
  });

  it('skips archived rooms for entity lookup', () => {
    const map = buildDealRoomByEntityKey([
      room('a', 'lic-1'),
      { ...room('b', 'lic-1'), status: 'archived' },
    ]);
    expect(getDealRoomForLicense(map, 'lic-1')?.id).toBe('a');
  });
});
