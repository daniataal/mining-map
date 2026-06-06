import { useQuery } from '@tanstack/react-query';
import { LucideShieldAlert } from 'lucide-react';
import { getSanctionsCountrySummary } from '../../api/oilLiveApi';
import OilLiveProvenanceBadge from '../live-data/OilLiveProvenanceBadge';
import { useI18n } from '../../lib/i18n';

type Props = {
  country: string;
};

export function CountrySanctionsSection({ country }: Props) {
  const { t } = useI18n();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['oil-live-sanctions-country-summary', country] as const,
    queryFn: () => getSanctionsCountrySummary(country),
    staleTime: 120_000,
    enabled: Boolean(country.trim()),
  });

  if (isLoading) {
    return (
      <p className="text-xs text-slate-500 animate-pulse">
        {t('טוען אות סנקציות…', 'Loading sanctions signal…')}
      </p>
    );
  }
  if (isError || !data) return null;

  const summary = data.countries[0];
  const entities = data.entities ?? [];
  const hasScreening = summary?.coverage === 'screened';

  return (
    <section className="space-y-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
      <h4 className="text-[10px] font-black uppercase tracking-widest text-red-700 dark:text-red-300 flex items-center gap-1.5">
        <LucideShieldAlert className="w-3.5 h-3.5" />
        {t('סינון OpenSanctions', 'OpenSanctions screening')}
      </h4>
      <OilLiveProvenanceBadge kind="evidence" className="mb-1" />
      {hasScreening ? (
        <ul className="text-xs space-y-1 text-slate-700 dark:text-slate-200">
          <li>
            <span className="font-bold uppercase">{summary.flag_level ?? 'clear'}</span>
            {' · '}
            {summary.match_count} {t('התאמות', 'matches')} · {summary.screened_entity_count}{' '}
            {t('ישויות נסקרו', 'entities screened')}
          </li>
          <li className="text-[10px] text-slate-500">
            {t('מקור', 'Source')}: {summary.source_tier}
            {data.api_key_configured ? ' · API key configured' : ' · public tier'}
          </li>
        </ul>
      ) : (
        <p className="text-xs text-slate-500">
          {t(
            'אין ישויות שנסקרו במאגר עבור מדינה זו — לא ידוע, לא "נקי"',
            'No screened counterparties stored for this country — unknown, not "clear"',
          )}
        </p>
      )}
      {entities.length > 0 && (
        <ul className="space-y-1 pt-1 border-t border-red-500/10">
          {entities.map((entity) => (
            <li key={entity.id} className="text-[11px]">
              <span className="font-semibold">{entity.name}</span>
              <span className="text-slate-500"> — {entity.sanctions_status}</span>
              {entity.opensanctions_entity_id && (
                <a
                  href={`https://www.opensanctions.org/entities/${encodeURIComponent(entity.opensanctions_entity_id)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-cyan-600 hover:underline dark:text-cyan-400"
                >
                  OpenSanctions
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] leading-snug text-slate-500 pt-1 border-t border-red-500/10">
        {data.disclaimer}
      </p>
    </section>
  );
}
