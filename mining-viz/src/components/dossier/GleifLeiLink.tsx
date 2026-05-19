import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

interface GleifLeiLinkProps {
  companyName: string;
  /** compact = dossier header chip; default = Raw Evidence card */
  variant?: 'default' | 'compact';
}

export default function GleifLeiLink({ companyName, variant = 'default' }: GleifLeiLinkProps) {
  const { t } = useI18n();
  const query = companyName.trim();
  const compact = variant === 'compact';

  const { data, isLoading } = useQuery({
    queryKey: ['gleif-lei', query],
    queryFn: async () => {
      const { data: body } = await apiClient.get<{
        status: string;
        matches?: Array<{
          lei?: string | null;
          legal_name?: string | null;
          status?: string | null;
          country?: string | null;
          gleif_url?: string | null;
        }>;
        match_count?: number;
      }>(`/api/companies/${encodeURIComponent(query)}/lei`);
      return body;
    },
    enabled: query.length >= 3,
    staleTime: 60 * 60_000,
  });

  if (!query || query.length < 3) return null;

  const match = data?.matches?.[0];

  if (compact) {
    if (isLoading) {
      return (
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
          {t('GLEIF…', 'GLEIF…')}
        </span>
      );
    }
    if (!match?.gleif_url) return null;
    return (
      <a
        href={match.gleif_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 h-4 text-[9px] font-black uppercase text-emerald-700 dark:text-emerald-300 shrink-0 hover:bg-emerald-500/20"
        title={match.legal_name || match.lei || 'GLEIF LEI'}
      >
        LEI
        {match.lei ? ` ${match.lei.slice(0, 8)}…` : ''}
      </a>
    );
  }

  if (!match?.gleif_url) {
    if (isLoading) {
      return (
        <p className="text-[10px] text-slate-500 uppercase tracking-widest">
          {t('מחפש ב-GLEIF...', 'Searching GLEIF LEI...')}
        </p>
      );
    }
    return null;
  }

  return (
    <motion.div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 space-y-2">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">GLEIF LEI</p>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {match.legal_name}
        {match.lei ? ` · LEI ${match.lei}` : ''}
        {match.country ? ` · ${match.country}` : ''}
        {match.status ? ` · ${match.status}` : ''}
      </p>
      <a
        href={match.gleif_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex text-[10px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-500"
      >
        {t('צפה ברשומת LEI', 'View LEI record')}
      </a>
    </motion.div>
  );
}
