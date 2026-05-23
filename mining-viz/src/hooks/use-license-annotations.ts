import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/api';
import { isAnnotationsAuthError } from '../lib/annotationsAuth';
import { fetchLicenseAnnotationsFromServer, resetSharedAnnotationsHydration } from '../lib/annotationsHydration';
import {
  blockAnnotationsServerHydration,
  clearMiningAuthStorage,
  isAnnotationsServerHydrationBlocked,
  isJwtExpired,
  resetAnnotationsHydrationSession,
} from '../lib/miningAuth';
import { normalizeAnnotationStage } from '../lib/dealWorkflow';
import type { UserAnnotation } from '../types';

export { isAnnotationsAuthError } from '../lib/annotationsAuth';

const LOCAL_STORAGE_KEY = 'mining_user_data';
const MIGRATION_FLAG_KEY = 'mining_annotations_migrated_v1';

export type UseLicenseAnnotationsOptions = {
  /** Called when the server rejects the stored JWT (expired / invalid). */
  onAuthInvalid?: () => void;
};

function readLocalAnnotations(): Record<string, UserAnnotation> {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function normalizeRecord(record: Record<string, UserAnnotation>): Record<string, UserAnnotation> {
  const out: Record<string, UserAnnotation> = {};
  for (const [id, ann] of Object.entries(record)) {
    out[id] = normalizeAnnotationStage(ann);
  }
  return out;
}

function mergeAnnotations(
  local: Record<string, UserAnnotation>,
  server: Record<string, UserAnnotation>,
): Record<string, UserAnnotation> {
  const merged: Record<string, UserAnnotation> = { ...normalizeRecord(local) };
  for (const [licenseId, serverAnn] of Object.entries(server)) {
    merged[licenseId] = normalizeAnnotationStage({
      ...(merged[licenseId] || {}),
      ...serverAnn,
    });
  }
  return merged;
}

/**
 * User license annotations: server is source of truth when logged in;
 * localStorage is offline cache / one-time migration source.
 */
export function useLicenseAnnotations(
  token: string | null | undefined,
  options?: UseLicenseAnnotationsOptions,
) {
  const [userAnnotations, setUserAnnotations] = useState<Record<string, UserAnnotation>>(() =>
    normalizeRecord(readLocalAnnotations()),
  );
  const [hydrated, setHydrated] = useState(false);
  const pendingWrites = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onAuthInvalidRef = useRef(options?.onAuthInvalid);
  onAuthInvalidRef.current = options?.onAuthInvalid;

  const invalidateSession = useCallback(() => {
    if (isAnnotationsServerHydrationBlocked()) return;
    blockAnnotationsServerHydration();
    clearMiningAuthStorage();
    onAuthInvalidRef.current?.();
  }, []);

  useEffect(() => {
    const sessionToken = token?.trim();
    if (!sessionToken) {
      resetAnnotationsHydrationSession();
      resetSharedAnnotationsHydration();
      setHydrated(true);
      return;
    }
    if (isAnnotationsServerHydrationBlocked()) {
      setHydrated(true);
      return;
    }
    if (isJwtExpired(sessionToken)) {
      invalidateSession();
      setHydrated(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { annotations: server } = await fetchLicenseAnnotationsFromServer(sessionToken);
        if (cancelled) return;
        const local = readLocalAnnotations();
        const merged = mergeAnnotations(local, server);
        setUserAnnotations(merged);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));

        const alreadyMigrated = localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
        if (!alreadyMigrated && Object.keys(local).length > 0) {
          for (const [licenseId, annotation] of Object.entries(local)) {
            const serverAnn = server[licenseId] || {};
            const localOnly = { ...annotation };
            for (const key of Object.keys(serverAnn)) {
              if (key in localOnly) delete localOnly[key];
            }
            if (Object.keys(localOnly).length > 0) {
              await apiClient.put(`/api/licenses/${encodeURIComponent(licenseId)}/annotations`, {
                annotation: { ...serverAnn, ...annotation },
              });
            }
          }
          localStorage.setItem(MIGRATION_FLAG_KEY, '1');
        } else if (!alreadyMigrated) {
          localStorage.setItem(MIGRATION_FLAG_KEY, '1');
        }
      } catch (err) {
        if (isAnnotationsAuthError(err)) {
          invalidateSession();
        } else {
          console.warn('[annotations] server hydration failed, using local cache', err);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, invalidateSession]);

  const persistToServer = useCallback(
    (licenseId: string, annotation: UserAnnotation) => {
      if (!token?.trim()) return;
      const existing = pendingWrites.current.get(licenseId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        pendingWrites.current.delete(licenseId);
        try {
          await apiClient.put(`/api/licenses/${encodeURIComponent(licenseId)}/annotations`, {
            annotation,
          });
        } catch (err) {
          if (isAnnotationsAuthError(err)) {
            invalidateSession();
          } else {
            console.warn(`[annotations] failed to save ${licenseId}`, err);
          }
        }
      }, 400);
      pendingWrites.current.set(licenseId, timer);
    },
    [token, invalidateSession],
  );

  const updateAnnotation = useCallback(
    (id: string, updates: Partial<UserAnnotation>) => {
      setUserAnnotations((prev) => {
        const nextAnn = normalizeAnnotationStage({ ...(prev[id] || {}), ...updates });
        const next = { ...prev, [id]: nextAnn };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        if (token?.trim()) {
          persistToServer(id, nextAnn);
        }
        return next;
      });
    },
    [token, persistToServer],
  );

  useEffect(() => {
    return () => {
      for (const timer of pendingWrites.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return { userAnnotations, updateAnnotation, annotationsHydrated: hydrated };
}
