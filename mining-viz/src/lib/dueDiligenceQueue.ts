export interface DdQueueEntry {
  id: string;
  addedAt: string;
  note?: string;
}

const STORAGE_KEY = 'mining_dd_queue';

export function loadDdQueue(): DdQueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DdQueueEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        typeof entry.addedAt === 'string',
    );
  } catch {
    return [];
  }
}

export function saveDdQueue(entries: DdQueueEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}
