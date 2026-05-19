import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

interface SecFilingsLinkProps {
  companyName: string;
}

export default function SecFilingsLink({ companyName }: SecFilingsLinkProps) {
  const { t } = useI18n();
  const query = companyName.trim();

  const { data, isLoading } = useQuery({
    queryKey: ['sec-filings', query],
    queryFn: async () => {
      const { data: body } = await apiClient.get<{
        status: string;
        best_match?: {
          company_name?: string;
          ticker?: string | null;
          cik?: string | null;
          edgar_url?: string | null;
          match_score?: number;
        } | null;
        match_count?: number;
      }>(`/api/companies/${encodeURIComponent(query)}/sec-filings`);
      return body;
    },
    enabled: query.length >= 3,
    staleTime: 60 * 60_000,
  });

  if (!query || query.length < 3) return null;

  const match = data?.best_match;
  if (!match?.edgar_url) {
    if (isLoading) {
      return (
        <p className="text-[10px] text-slate-500 uppercase tracking-widest">
          {t('מחפש ב-SEC EDGAR...', 'Searching SEC EDGAR...')}
        </p>
      );
    }
    return null;
  }

  return (
    <motion.div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 space-y-2">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">SEC EDGAR (US)</p>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {match.company_name}
        {match.ticker ? ` (${match.ticker})` : ''}
        {match.cik ? ` · CIK ${match.cik}` : ''}
      </p>
      <a
        href={match.edgar_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex text-[10px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-500"
      >
        {t('צפה בהגשות SEC', 'View SEC filings')}
      </a>
    </motion.div>
  );
}
