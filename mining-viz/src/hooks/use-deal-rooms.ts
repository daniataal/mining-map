import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listDealRooms } from '../lib/api';
import { buildDealRoomByEntityKey, isDealRoomArchived } from '../lib/dealRoomIndex';
import type { DealRoom } from '../types';

const DEAL_ROOMS_QUERY_KEY = ['deal-rooms'] as const;

export function useDealRooms(enabled = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: DEAL_ROOMS_QUERY_KEY,
    queryFn: () => listDealRooms({ includeArchived: true }),
    enabled,
    staleTime: 30_000,
  });

  const rooms = query.data ?? [];
  const activeRooms = useMemo(() => rooms.filter((room) => !isDealRoomArchived(room)), [rooms]);

  const roomsByEntityKey = useMemo(() => buildDealRoomByEntityKey(rooms), [rooms]);

  const getRoomForEntity = useCallback(
    (entityId: string, entityKind = 'license') =>
      roomsByEntityKey.get(`${entityKind}:${entityId}`),
    [roomsByEntityKey],
  );

  const refreshDealRooms = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: DEAL_ROOMS_QUERY_KEY });
  }, [queryClient]);

  const upsertDealRoom = useCallback(
    (room: DealRoom) => {
      queryClient.setQueryData<DealRoom[]>(DEAL_ROOMS_QUERY_KEY, (prev) => {
        const list = prev ?? [];
        const idx = list.findIndex((item) => item.id === room.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = room;
          return next;
        }
        return [room, ...list];
      });
    },
    [queryClient],
  );

  return {
    rooms,
    activeRooms,
    roomsByEntityKey,
    getRoomForEntity,
    count: activeRooms.length,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refreshDealRooms,
    upsertDealRoom,
  };
}
