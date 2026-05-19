import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

interface CompanyRegistryLinksProps {
  companyName: string;
  country?: string;
  variant?: 'default' | 'compact';
}

interface RegistryLink {
  label: string;
  url: string;
  description?: string;
  disclaimer?: string;
  manual_only?: boolean;
  api_backed?: boolean;
}

export default function CompanyRegistryLinks({
  companyName,
  country = '',
  variant = 'default',
}: CompanyRegistryLinksProps) {
  const { t } = useI18n();
  const query = companyName.trim();
  const compact = variant === 'compact';

  const { data, isLoading } = useQuery({
    queryKey: ['registry-links', query, country],
    queryFn: async () => {
      const { data: body } = await apiClient.get<{
        links?: RegistryLink[];
        opencorporates_disclaimer?: string;
      }>(`/api/companies/${encodeURIComponent(query)}/registry-links`, {
        params: country ? { country } : undefined,
      });
      return body;
    },
    enabled: query.length >= 2,
    staleTime: 60 * 60_000,
  });

  if (!query || query.length < 2) return null;

  const ocLink = data?.links?.find((l) => l.label.toLowerCase().includes('opencorporates'));
  const national = data?.links?.find((l) => !l.label.toLowerCase().includes('opencorporates'));
  const disclaimer =
    data?.opencorporates_disclaimer ||
    'Manual verification, not API-backed — OpenCorporates API is paid.';

  if (compact) {
    if (isLoading) {
      return (
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
          {t('רישום…', 'Registry…')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 shrink-0 flex-wrap">
        {ocLink?.url && (
          <a
            href={ocLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-slate-500/25 bg-slate-500/10 px-1.5 h-4 text-[9px] font-black uppercase text-slate-600 dark:text-slate-300 hover:bg-slate-500/20"
            title={disclaimer}
          >
            OC
          </a>
        )}
        {national?.url && (
          <a
            href={national.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-blue-500/25 bg-blue-500/10 px-1.5 h-4 text-[9px] font-black uppercase text-blue-700 dark:text-blue-300 hover:bg-blue-500/20"
            title={national.description || national.label}
          >
            {t('רישום', 'Reg')}
          </a>
        )}
      </span>
    );
  }

  if (!data?.links?.length && !isLoading) return null;

  return (
    <motion.div className="rounded-2xl border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 space-y-2">
      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
        {t('אימות חברה (ידני)', 'Company verification (manual)')}
      </p>
      <p className="text-[10px] text-amber-700 dark:text-amber-400">{disclaimer}</p>
      <ul className="space-y-2">
        {(data?.links || []).map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-amber-600 hover:text-amber-500"
            >
              {link.label}
            </a>
            {link.description && (
              <p className="text-[10px] text-slate-500 mt-0.5">{link.description}</p>
            )}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
