import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import GleifLeiLink from './GleifLeiLink';

type Props = {
  companyName: string;
  country?: string;
  operatorName?: string | null;
};

function manualSearchLink(label: string, url: string): { label: string; url: string } {
  return { label, url };
}

/**
 * Honest contact envelope: GLEIF LEI + free registry deep links + manual Wikidata/SEC search.
 * Does not fabricate phone numbers — dossier resolve only.
 */
export default function CompanyContactEnvelope({
  companyName,
  country = '',
  operatorName,
}: Props) {
  const { t } = useI18n();
  const primary = (operatorName || companyName).trim();
  if (!primary) return null;

  const { data: registry } = useQuery({
    queryKey: ['registry-links', primary, country],
    queryFn: async () => {
      const { data } = await apiClient.get<{
        links?: Array<{ label?: string; url?: string; description?: string }>;
        limitations?: string[];
      }>(`/api/companies/${encodeURIComponent(primary)}/registry-links`, {
        params: country ? { country } : {},
      });
      return data;
    },
    enabled: primary.length >= 2,
    staleTime: 60 * 60_000,
  });

  const manualLinks = [
    manualSearchLink(
      'Wikidata',
      `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(primary)}`,
    ),
    manualSearchLink(
      'SEC EDGAR',
      `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(primary)}`,
    ),
  ];

  return (
    <div className="space-y-3 rounded-2xl border border-black/5 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        {t('זיהוי ויצירת קשר (פתוח)', 'Identity & contact (open data)')}
      </p>
      <GleifLeiLink companyName={primary} />
      {registry?.links?.map((link) =>
        link.url ? (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 text-[11px] font-semibold text-amber-700 hover:text-amber-600 dark:text-amber-300"
          >
            <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {link.label || t('רשם חברות', 'Company registry')}
              {link.description ? (
                <span className="block font-normal text-slate-500">{link.description}</span>
              ) : null}
            </span>
          </a>
        ) : null,
      )}
      <div className="flex flex-wrap gap-2">
        {manualLinks.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-200"
          >
            {link.label}
          </a>
        ))}
      </div>
      <p className="text-[9px] leading-relaxed text-slate-500">
        {t(
          'קישורים לבדיקה ידנית בלבד — ללא מספרי טלפון מומצאים.',
          'Manual verification links only — no fabricated phone numbers.',
        )}
      </p>
    </div>
  );
}
