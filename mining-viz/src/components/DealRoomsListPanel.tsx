import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus, Search } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { createDealRoom } from '../lib/api';
import type { DealRoom, MiningLicense } from '../types';
import DealRoomPanel from './DealRoomPanel';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

interface DealRoomsListPanelProps {
  rooms: DealRoom[];
  allLicenses: MiningLicense[];
  isLoading?: boolean;
  highlightedRoomId?: string | null;
  onHighlightedRoomConsumed?: () => void;
  onRoomChange: (room: DealRoom) => void;
  onRefresh: () => void;
  onOpenEntity: (item: MiningLicense) => void;
}

export default function DealRoomsListPanel({
  rooms,
  allLicenses,
  isLoading = false,
  highlightedRoomId,
  onHighlightedRoomConsumed,
  onRoomChange,
  onRefresh,
  onOpenEntity,
}: DealRoomsListPanelProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const licenseById = useMemo(
    () => Object.fromEntries(allLicenses.map((item) => [item.id, item])),
    [allLicenses],
  );

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) => {
      const license = licenseById[room.entityId];
      const haystack = [
        room.title,
        room.entityId,
        room.status,
        license?.company,
        license?.country,
        license?.commodity,
        String(room.entity?.company ?? ''),
        String(room.entity?.country ?? ''),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [licenseById, rooms, search]);

  useEffect(() => {
    if (!highlightedRoomId) return;
    setSelectedId(highlightedRoomId);
    onHighlightedRoomConsumed?.();
  }, [highlightedRoomId, onHighlightedRoomConsumed]);

  useEffect(() => {
    if (selectedId && !rooms.some((room) => room.id === selectedId)) {
      setSelectedId(null);
    }
  }, [rooms, selectedId]);

  const selectedRoom = rooms.find((room) => room.id === selectedId) ?? null;
  const selectedEntity = selectedRoom ? licenseById[selectedRoom.entityId] ?? null : null;

  async function handleCreateBlank() {
    setIsCreating(true);
    setCreateError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const created = await createDealRoom({
        entityId: `manual-${Date.now()}`,
        entityKind: 'investigation',
        title: t(`חקירה ${stamp}`, `Investigation ${stamp}`),
        status: 'draft',
      });
      onRoomChange(created);
      setSelectedId(created.id);
      await onRefresh();
    } catch {
      setCreateError(t('לא ניתן ליצור חדר עסקאות', 'Could not create deal room.'));
    } finally {
      setIsCreating(false);
    }
  }

  if (selectedRoom) {
    return (
      <div className="max-w-5xl mx-auto w-full px-2 sm:px-4 pb-8 overflow-y-auto">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedId(null)}
            className="rounded-xl text-[10px] font-black uppercase tracking-widest"
          >
            {t('← כל החדרים', '← All rooms')}
          </Button>
          {selectedEntity && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenEntity(selectedEntity)}
              className="rounded-xl text-[10px] font-black uppercase tracking-widest"
            >
              {t('פתח תיקייה', 'Open dossier')}
            </Button>
          )}
        </div>
        <DealRoomPanel
          dealRoom={selectedRoom}
          entity={selectedEntity}
          onDealRoomChange={(room) => {
            onRoomChange(room);
            setSelectedId(room.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden px-2 sm:px-4 pb-8">
      <header className="shrink-0 space-y-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white italic">
              {t('חדרי עסקאות', 'Deal Rooms')}
            </h2>
            <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-300 border-none text-[10px] font-black uppercase">
              {rooms.length} {t('פעילים', 'active')}
            </Badge>
          </div>
          <Button
            type="button"
            onClick={handleCreateBlank}
            disabled={isCreating}
            className="h-9 rounded-xl bg-amber-500 text-[10px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-600"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {isCreating ? t('יוצר…', 'Creating…') : t('חדר חדש', 'New room')}
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('חיפוש לפי כותרת, חברה, מדינה…', 'Search title, company, country…')}
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-white dark:bg-slate-950 border border-black/10 dark:border-white/10 text-sm font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
          />
        </div>
        {createError && (
          <p className="text-xs font-bold text-red-500">{createError}</p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <p className="text-sm font-semibold text-slate-500">{t('טוען חדרים…', 'Loading deal rooms…')}</p>
        ) : filteredRooms.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-black/10 dark:border-white/10 p-10 text-center">
            <Briefcase className="w-10 h-10 mx-auto text-slate-400 mb-3" />
            <p className="text-sm font-bold text-slate-500">
              {rooms.length === 0
                ? t(
                    'אין עדיין חדרי עסקאות. הוסף רישיון מתיקייה או צור חדר חדש.',
                    'No deal rooms yet. Add a license from a dossier or create a new room.',
                  )
                : t('אין תוצאות לחיפוש.', 'No rooms match your search.')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
            {filteredRooms.map((room) => {
              const license = licenseById[room.entityId];
              const isHighlighted = room.id === highlightedRoomId;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedId(room.id)}
                  className={`text-left rounded-2xl border p-4 transition-all hover:border-amber-500/40 hover:bg-amber-500/[0.04] ${
                    isHighlighted
                      ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30'
                      : 'border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]'
                  }`}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                    {room.status}
                  </p>
                  <p className="mt-1 text-sm font-black uppercase text-slate-900 dark:text-white line-clamp-2">
                    {room.title}
                  </p>
                  <p className="mt-2 text-[11px] font-semibold text-slate-500 line-clamp-2">
                    {license?.company || String(room.entity?.company || room.entityId)}
                    {license?.country || room.entity?.country
                      ? ` · ${license?.country || room.entity?.country}`
                      : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {room.routeSnapshot && (
                      <Badge className="border-none bg-emerald-500/15 text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300">
                        {t('מסלול', 'Route')}
                      </Badge>
                    )}
                    {license && (
                      <Badge className="border-none bg-slate-500/10 text-[9px] font-black uppercase text-slate-600 dark:text-slate-300">
                        {t('רישיון', 'License')}
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
