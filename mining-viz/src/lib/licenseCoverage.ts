import type {
  CountrySectorCoverage,
  CoverageStatus,
  WorldCoverageCountry,
  WorldCoverageResponse,
} from '../types';

export type LicenseCoverageSector = 'mining' | 'oil_and_gas';

export type SectorCoverageSummary = Record<string, number>;

export const COVERAGE_STATUS_LABELS: Record<CoverageStatus, string> = {
  official_syncable: 'Official live',
  global_fallback_only: 'Global fallback',
  official_api_restricted: 'API restricted',
  official_portal_only: 'Portal only',
  decommissioned: 'Decommissioned',
  unavailable: 'Unavailable',
};

export function sectorCoverageSummary(
  worldCoverage: WorldCoverageResponse | null | undefined,
  sector: LicenseCoverageSector,
): SectorCoverageSummary | null {
  const summary = worldCoverage?.summary?.[sector];
  if (!summary || typeof summary !== 'object') return null;
  return summary;
}

export function formatCoverageSummaryCounts(summary: SectorCoverageSummary | null): string | null {
  if (!summary) return null;
  const official = summary.official_syncable ?? 0;
  const fallback = summary.global_fallback_only ?? 0;
  const partial =
    (summary.official_api_restricted ?? 0) +
    (summary.official_portal_only ?? 0) +
    (summary.decommissioned ?? 0);
  const csvFallback = summary.fallback_imported ?? 0;
  if (official + fallback + partial + csvFallback === 0) return null;
  return `${official} official live · ${fallback} global fallback · ${partial} official partial · ${csvFallback} CSV fallback`;
}

export function countryHasSectorSignal(
  row: WorldCoverageCountry,
  sector: LicenseCoverageSector,
): boolean {
  const coverage = row.sectors[sector];
  if (!coverage) return false;
  if (coverage.status !== 'unavailable') return true;
  return (
    (coverage.record_count ?? 0) > 0 ||
    (coverage.global_fallback_record_count ?? 0) > 0 ||
    (coverage.fallback_record_count ?? 0) > 0
  );
}

export function countriesForSector(
  worldCoverage: WorldCoverageResponse | null | undefined,
  sector: LicenseCoverageSector,
  limit = 12,
): Array<{ country: string; coverage: CountrySectorCoverage }> {
  const rows = worldCoverage?.countries ?? [];
  return rows
    .filter((row) => countryHasSectorSignal(row, sector))
    .map((row) => ({ country: row.country, coverage: row.sectors[sector] }))
    .sort((a, b) => {
      const aCount =
        (a.coverage.record_count ?? 0) +
        (a.coverage.global_fallback_record_count ?? 0) +
        (a.coverage.fallback_record_count ?? 0);
      const bCount =
        (b.coverage.record_count ?? 0) +
        (b.coverage.global_fallback_record_count ?? 0) +
        (b.coverage.fallback_record_count ?? 0);
      return bCount - aCount;
    })
    .slice(0, limit);
}

export function miningSourceIds(
  worldCoverage: WorldCoverageResponse | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const source of worldCoverage?.sources ?? []) {
    if (source.sector === 'mining' && source.source_id) ids.add(source.source_id);
  }
  return ids;
}

export type LicenseSyncRunRow = {
  source_id?: string | null;
  status?: string;
  finished_at?: string | null;
  started_at?: string;
};

export function latestSyncForSources(
  runs: LicenseSyncRunRow[] | null | undefined,
  sourceIds: Set<string>,
): LicenseSyncRunRow | null {
  if (!runs?.length || sourceIds.size === 0) return null;
  let best: LicenseSyncRunRow | null = null;
  let bestTs = 0;
  for (const run of runs) {
    const sid = run.source_id?.trim();
    if (!sid || !sourceIds.has(sid)) continue;
    const ts = Date.parse(run.finished_at || run.started_at || '');
    if (!Number.isFinite(ts)) continue;
    if (!best || ts > bestTs) {
      best = run;
      bestTs = ts;
    }
  }
  return best;
}

export function formatSyncTimestamp(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
