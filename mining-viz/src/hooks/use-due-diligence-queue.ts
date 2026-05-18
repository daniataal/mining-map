import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useI18n } from '../lib/i18n';
import { DdQueueEntry, loadDdQueue, saveDdQueue } from '../lib/dueDiligenceQueue';

export function useDueDiligenceQueue() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<DdQueueEntry[]>(() => loadDdQueue());

  useEffect(() => {
    saveDdQueue(queue);
  }, [queue]);

  const queueIds = useMemo(() => new Set(queue.map((entry) => entry.id)), [queue]);

  const isInQueue = useCallback((id: string) => queueIds.has(id), [queueIds]);

  const addToQueue = useCallback(
    (id: string) => {
      setQueue((prev) => {
        if (prev.some((entry) => entry.id === id)) return prev;
        return [...prev, { id, addedAt: new Date().toISOString() }];
      });
      toast.success(t('נוסף לבדיקת נאותות', 'Added to Due Diligence'), {
        description: t('מופיע בלשונית חקירות → בדיקת נאותות', 'Visible in Investigations → Due Diligence'),
      });
    },
    [t],
  );

  const removeFromQueue = useCallback(
    (id: string) => {
      setQueue((prev) => prev.filter((entry) => entry.id !== id));
      toast.info(t('הוסר מבדיקת הנאותות', 'Removed from Due Diligence'));
    },
    [t],
  );

  const toggleQueue = useCallback(
    (id: string) => {
      if (queueIds.has(id)) {
        removeFromQueue(id);
      } else {
        addToQueue(id);
      }
    },
    [addToQueue, queueIds, removeFromQueue],
  );

  const updateNote = useCallback((id: string, note: string) => {
    setQueue((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, note: note.trim() || undefined } : entry)),
    );
  }, []);

  const notesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of queue) {
      if (entry.note) map[entry.id] = entry.note;
    }
    return map;
  }, [queue]);

  return {
    queue,
    queueIds,
    notesById,
    isInQueue,
    addToQueue,
    removeFromQueue,
    toggleQueue,
    updateNote,
  };
}
