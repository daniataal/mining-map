import type { MiningLicense } from '../types';

/** One cached payload per map view mode (not per country or viewport). */
export type LicenseBundleMode = 'mining' | 'oil_and_gas' | 'global';

/**
 * Persistent cache keys (IndexedDB store + sessionStorage mirror):
 *   meridian:license-bundle:mining
 *   meridian:license-bundle:oil_and_gas
 *   meridian:license-bundle:global
 *
 * TTL: 1 hour — repeat visits within the hour hydrate instantly from disk.
 */
export const LICENSE_BUNDLE_TTL_MS = 60 * 60 * 1000;

const IDB_NAME = 'meridian-license-bundles';
const IDB_STORE = 'bundles';
const SESSION_PREFIX = 'meridian:license-bundle:';

export type LicenseBundleCacheEntry = {
  licenses: MiningLicense[];
  fetchedAt: number;
};

function cacheKey(mode: LicenseBundleMode): string {
  return `${SESSION_PREFIX}${mode}`;
}

function isFresh(entry: LicenseBundleCacheEntry, now = Date.now()): boolean {
  return now - entry.fetchedAt < LICENSE_BUNDLE_TTL_MS;
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onerror = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbGet(db: IDBDatabase, mode: LicenseBundleMode): Promise<LicenseBundleCacheEntry | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(mode);
    req.onsuccess = () => {
      const raw = req.result as LicenseBundleCacheEntry | undefined;
      resolve(raw && Array.isArray(raw.licenses) ? raw : null);
    };
    req.onerror = () => resolve(null);
  });
}

function idbPut(db: IDBDatabase, mode: LicenseBundleMode, entry: LicenseBundleCacheEntry): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(entry, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function readSessionEntry(mode: LicenseBundleMode): LicenseBundleCacheEntry | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LicenseBundleCacheEntry;
    if (!parsed || !Array.isArray(parsed.licenses) || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionEntry(mode: LicenseBundleMode, entry: LicenseBundleCacheEntry): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(cacheKey(mode), JSON.stringify(entry));
  } catch {
    /* quota or private mode */
  }
}

/** Synchronous read for React Query initialData (sessionStorage mirror only). */
export function readLicenseBundleCacheSync(mode: LicenseBundleMode): LicenseBundleCacheEntry | null {
  const entry = readSessionEntry(mode);
  if (!entry || !isFresh(entry)) return null;
  return entry;
}

/** Async read — IndexedDB first, then sessionStorage mirror. */
export async function readLicenseBundleCache(mode: LicenseBundleMode): Promise<LicenseBundleCacheEntry | null> {
  const db = await openIdb();
  if (db) {
    try {
      const fromIdb = await idbGet(db, mode);
      if (fromIdb) {
        writeSessionEntry(mode, fromIdb);
        return fromIdb;
      }
    } finally {
      db.close();
    }
  }
  return readSessionEntry(mode);
}

export async function writeLicenseBundleCache(
  mode: LicenseBundleMode,
  licenses: MiningLicense[],
): Promise<void> {
  const entry: LicenseBundleCacheEntry = { licenses, fetchedAt: Date.now() };
  writeSessionEntry(mode, entry);
  const db = await openIdb();
  if (!db) return;
  try {
    await idbPut(db, mode, entry);
  } finally {
    db.close();
  }
}

export function isLicenseBundleCacheFresh(entry: LicenseBundleCacheEntry | null | undefined): boolean {
  return Boolean(entry && isFresh(entry));
}

export function licenseBundleModeFromSector(
  sector?: 'mining' | 'oil_and_gas',
): LicenseBundleMode {
  if (sector === 'mining') return 'mining';
  if (sector === 'oil_and_gas') return 'oil_and_gas';
  return 'global';
}

/** Clears all view-mode bundles (IndexedDB + sessionStorage). */
export async function clearLicenseBundleCaches(): Promise<void> {
  if (typeof sessionStorage !== 'undefined') {
    for (const mode of ['mining', 'oil_and_gas', 'global'] as LicenseBundleMode[]) {
      sessionStorage.removeItem(cacheKey(mode));
    }
  }
  const db = await openIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const mode of ['mining', 'oil_and_gas', 'global'] as LicenseBundleMode[]) {
      store.delete(mode);
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}
