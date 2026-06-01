function envFlag(name: string): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Dev-only: show graph-sync seed port-call rows in Live Data cargo lists. */
export function canShowSeedDataToggle(): boolean {
  if (envFlag('VITE_ALLOW_SEED_DATA_TOGGLE')) return true;
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/** Dev/local: optional BarentsWatch government AIS coverage overlay filter (MAD-61). */
export function canToggleGovernmentAisCoverage(): boolean {
  if (envFlag('VITE_GOVERNMENT_AIS_COVERAGE_LAYER')) return true;
  return canShowSeedDataToggle();
}

/** Production hides demo/seed provenance badges; inferred MCR tiers remain labelled. */
export function shouldShowProvenanceBadge(kind?: string | null): boolean {
  if (!kind || kind === 'unknown') return false;
  if (canShowSeedDataToggle()) return true;
  return kind !== 'seed_port_calls';
}
