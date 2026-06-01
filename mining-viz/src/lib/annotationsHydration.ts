import { apiClient } from './api';
import type { UserAnnotation } from '../types';

type HydrationPayload = { annotations: Record<string, UserAnnotation> };

let sharedHydration: { token: string; promise: Promise<HydrationPayload> } | null = null;

/** One in-flight GET /api/licenses/annotations per token (Strict Mode safe). */
export function fetchLicenseAnnotationsFromServer(token: string): Promise<HydrationPayload> {
  const key = token.trim();
  if (sharedHydration?.token === key) {
    return sharedHydration.promise;
  }
  const promise = apiClient
    .get<{ annotations?: Record<string, UserAnnotation> }>('/api/licenses/annotations')
    .then(({ data }) => ({ annotations: data?.annotations || {} }))
    .finally(() => {
      if (sharedHydration?.token === key) {
        sharedHydration = null;
      }
    });
  sharedHydration = { token: key, promise };
  return promise;
}

export function resetSharedAnnotationsHydration(): void {
  sharedHydration = null;
}
