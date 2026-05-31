/** Normalize ShipVault vs AIS type labels for honest side-by-side display. */

export function normalizeTypeLabel(value?: string | null): string {
  if (!value) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

export function typesMismatch(aisLabel?: string | null, registryLabel?: string | null): boolean {
  const a = normalizeTypeLabel(aisLabel).toLowerCase();
  const b = normalizeTypeLabel(registryLabel).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return false;
  if (a.includes(b) || b.includes(a)) return false;
  return true;
}

export function formatTonnage(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function formatAgeYears(value?: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(1);
}
