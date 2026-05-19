import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { useWorldCoverage } from '@/lib/api';
import type { CountrySectorCoverage, CoverageStatus } from '@/types';

const STATUS_LABELS: Record<CoverageStatus, string> = {
  official_syncable: 'Official live sync',
  global_fallback_only: 'Global fallback only',
  official_api_restricted: 'Official API restricted',
  official_portal_only: 'Official portal only',
  decommissioned: 'Decommissioned',
  unavailable: 'Unavailable',
};

const STATUS_COLORS: Record<CoverageStatus, string> = {
  official_syncable: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  global_fallback_only: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  official_api_restricted: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  official_portal_only: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  decommissioned: 'bg-slate-500/10 text-slate-500',
  unavailable: 'bg-slate-500/10 text-slate-500',
};

function SectorBlock({
  label,
  coverage,
}: {
  label: string;
  coverage: CountrySectorCoverage;
}) {
  const status = (coverage.status || 'unavailable') as CoverageStatus;
  return (
    <motion.div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <Badge className={`border-none text-[9px] font-black uppercase ${STATUS_COLORS[status] || STATUS_COLORS.unavailable}`}>
          {STATUS_LABELS[status] || status}
        </Badge>
      </div>
      {coverage.record_count > 0 && (
        <p className="text-[11px] text-slate-600 dark:text-slate-400">
          {coverage.record_count} synced record{coverage.record_count === 1 ? '' : 's'}
          {coverage.last_synced_at ? ` · last sync ${coverage.last_synced_at.slice(0, 10)}` : ''}
        </p>
      )}
      {coverage.source_ids?.length > 0 && (
        <p className="text-[10px] text-slate-500 font-mono break-all">
          {coverage.source_ids.join(', ')}
        </p>
      )}
      {coverage.note && (
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{coverage.note}</p>
      )}
      {coverage.references?.length > 0 && (
        <ul className="text-[10px] space-y-1">
          {coverage.references.slice(0, 4).map((ref) => (
            <li key={ref.url}>
              <a
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 dark:text-amber-400 hover:underline"
              >
                {ref.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

/** Data coverage for a single country (from world coverage API, client-filtered). */
export function CountryCoveragePanel({ country }: { country: string }) {
  const { data, isLoading, isError } = useWorldCoverage(Boolean(country), 'all', country);

  const countryRow = useMemo(() => {
    if (!data?.countries?.length || !country) return null;
    if (data.countries.length === 1) return data.countries[0];
    const needle = country.trim().toLowerCase();
    return data.countries.find((c) => c.country?.trim().toLowerCase() === needle) ?? null;
  }, [data, country]);

  if (!country) return null;

  return (
    <div className="p-6 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-3xl space-y-3">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
        Data coverage for {country}
      </p>
      {isLoading && <p className="text-[11px] text-slate-500">Loading coverage…</p>}
      {isError && (
        <p className="text-[11px] text-slate-500">Coverage metadata unavailable.</p>
      )}
      {!isLoading && !countryRow && (
        <p className="text-[11px] text-slate-500">
          No coverage entry for this country in the world catalog.
        </p>
      )}
      {countryRow && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SectorBlock label="Mining" coverage={countryRow.sectors.mining} />
          <SectorBlock label="Oil & gas" coverage={countryRow.sectors.oil_and_gas} />
        </div>
      )}
    </div>
  );
}
