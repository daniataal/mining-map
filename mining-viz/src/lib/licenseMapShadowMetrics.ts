/** Dev/staging shadow metrics for Go vs Python license map fallback (console only). */

export const LICENSE_MAP_SHADOW_METRICS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_LICENSE_MAP_SHADOW_METRICS === '1';

export type LicenseMapShadowPathKind = 'go' | 'python';

export type LicenseMapShadowEntry = {
  at: number;
  kind: 'bundle' | 'viewport';
  path: string;
  pathKind: LicenseMapShadowPathKind;
  latencyMs: number;
  usedFallback: boolean;
  fallbackError?: string;
  sector?: string;
};

const RING_MAX = 50;
const ring: LicenseMapShadowEntry[] = [];

export function licenseMapPathKind(path: string): LicenseMapShadowPathKind {
  return path.includes('/api/oil-live/') ? 'go' : 'python';
}

export function recordLicenseMapShadowMetric(
  entry: Omit<LicenseMapShadowEntry, 'at'>,
): void {
  if (!LICENSE_MAP_SHADOW_METRICS_ENABLED) return;
  const full: LicenseMapShadowEntry = { ...entry, at: Date.now() };
  ring.push(full);
  if (ring.length > RING_MAX) ring.shift();
  console.debug('[license-map-shadow]', full);
}

/** In-memory ring buffer for devtools inspection (not persisted). */
export function getLicenseMapShadowMetrics(): readonly LicenseMapShadowEntry[] {
  return ring;
}

export function clearLicenseMapShadowMetrics(): void {
  ring.length = 0;
}
