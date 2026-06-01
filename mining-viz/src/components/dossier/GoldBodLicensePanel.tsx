import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck, ShieldAlert, ShieldQuestion, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { MiningLicense } from '../../types';
import { apiClient } from '../../lib/api';
import { isGhanaGoldEntity } from '../../lib/goldbodEligibility';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';

export type GoldBodStatus = 'active' | 'not_found' | 'unknown' | 'api_unavailable' | 'check_manually';

interface GoldBodMatch {
  business_name?: string;
  certificate_number?: string;
  issue_date?: string;
  expiry_date?: string;
  license_category?: string;
  is_active?: boolean;
  match_score?: number;
}

interface GoldBodLicenseResponse {
  status?: GoldBodStatus;
  eligible?: boolean;
  company_name?: string;
  data_source?: string;
  api_available?: boolean;
  registry_available?: boolean;
  matches?: GoldBodMatch[];
  active_match?: GoldBodMatch | null;
  links?: { label: string; url: string; note?: string }[];
  manual_checklist?: string[];
  limitations?: string[];
}

interface GoldBodLicensePanelProps {
  item: MiningLicense;
  commodityLabel?: string;
}

function statusBadge(status: GoldBodStatus | undefined, t: (he: string, en: string) => string) {
  switch (status) {
    case 'active':
      return {
        label: t('רישיון פעיל', 'Active license'),
        className: 'bg-emerald-500 text-white',
        Icon: ShieldCheck,
      };
    case 'not_found':
      return {
        label: t('לא נמצא', 'Not found'),
        className: 'bg-red-500/90 text-white',
        Icon: ShieldAlert,
      };
    case 'api_unavailable':
      return {
        label: t('API לא זמין', 'API unavailable'),
        className: 'bg-amber-600 text-white',
        Icon: AlertTriangle,
      };
    case 'check_manually':
      return {
        label: t('אימות ידני', 'Check manually'),
        className: 'bg-slate-500 text-white',
        Icon: ShieldQuestion,
      };
    default:
      return {
        label: t('לא מאומת', 'Unverified'),
        className: 'bg-slate-400 text-white',
        Icon: ShieldQuestion,
      };
  }
}

export default function GoldBodLicensePanel({ item, commodityLabel }: GoldBodLicensePanelProps) {
  const { t } = useI18n();
  const commodity = commodityLabel || item.commodity || '';
  const eligible = useMemo(
    () => isGhanaGoldEntity(item.country, commodity),
    [item.country, commodity],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ['goldbod-license', item.id, item.entityKind || 'license'],
    queryFn: async () => {
      const { data: body } = await apiClient.get<GoldBodLicenseResponse>(
        `/entities/${encodeURIComponent(item.id)}/goldbod-license`,
        { params: { entity_kind: item.entityKind || 'license' } },
      );
      return body;
    },
    enabled: Boolean(item.id) && eligible,
    staleTime: 60 * 60_000,
  });

  if (!eligible) return null;

  const badge = statusBadge(data?.status, t);
  const BadgeIcon = badge.Icon;
  const honesty =
    data?.data_source === 'partner_api'
      ? t('נתונים מ-API שותף (GOLDBOD_API_BASE_URL)', 'Data from partner API (GOLDBOD_API_BASE_URL)')
      : data?.data_source === 'public_registry'
        ? t(
            'התאמה לרישום ציבורי GoldBod — לא API רשמי; אימות ידני מומלץ.',
            'Matched public GoldBod License Registry — not an official REST API; manual confirmation recommended.',
          )
        : t(
            'אין נתוני API חיים — השתמש בקישורים ובצ׳קליסט לאימות ידני.',
            'No live API data — use links and checklist for manual verification.',
          );

  return (
    <Card className="rounded-3xl border border-amber-500/25 bg-amber-500/5 p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
            {t('רישיון GoldBod', 'GoldBod License')}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {t(
              'Ghana Gold Board — רגולטור יחיד לרכישה, דירוג וייצוא זהב',
              'Ghana Gold Board — sole regulator for buying, grading, and exporting gold',
            )}
          </p>
        </div>
        <Badge className={`${badge.className} text-[9px] font-black uppercase border-none shrink-0`}>
          <BadgeIcon className="h-3 w-3 mr-1 inline" />
          {isLoading ? t('בודק…', 'Checking…') : badge.label}
        </Badge>
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-900 dark:text-amber-100">
        {honesty}
      </div>

      {isError && (
        <p className="text-[11px] text-red-600">
          {t('שגיאה בטעינת אימות GoldBod', 'Failed to load GoldBod verification')}
        </p>
      )}

      {data?.active_match && (
        <div className="text-[11px] space-y-1 text-slate-700 dark:text-slate-200">
          <p className="font-bold">{data.active_match.business_name}</p>
          <p>
            <span className="text-slate-500">{t('מספר רישיון', 'Certificate')}:</span>{' '}
            {data.active_match.certificate_number}
          </p>
          {(data.active_match.issue_date || data.active_match.expiry_date) && (
            <p>
              <span className="text-slate-500">{t('תוקף', 'Validity')}:</span>{' '}
              {data.active_match.issue_date || '—'} → {data.active_match.expiry_date || '—'}
            </p>
          )}
          {data.active_match.license_category && (
            <p className="text-[10px] uppercase text-slate-500">{data.active_match.license_category}</p>
          )}
        </div>
      )}

      {!isLoading && data?.status === 'not_found' && !data?.active_match && (
        <p className="text-[11px] text-slate-600 dark:text-slate-300">
          {t(
            'לא נמצאה התאמה ברישום הציבורי — ייתכן שאין רישיון GoldBod או שהשם שונה.',
            'No match in the public registry — entity may lack a GoldBod license or use a different legal name.',
          )}
        </p>
      )}

      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
          {t('קישורים רשמיים', 'Official links')}
        </p>
        <div className="flex flex-wrap gap-2">
          {(data?.links || []).map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={link.note}
              className="inline-flex items-center gap-1 rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-[9px] font-black uppercase hover:bg-black/5 dark:hover:bg-white/5"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      </div>

      {(data?.manual_checklist || []).length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
            {t('צ׳קליסט אימות ידני', 'Manual verification checklist')}
          </p>
          <ul className="list-disc list-inside text-[10px] text-slate-600 dark:text-slate-300 space-y-1">
            {data!.manual_checklist!.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {(data?.limitations || []).map((lim) => (
        <p key={lim} className="text-[9px] text-slate-500">
          {lim}
        </p>
      ))}
    </Card>
  );
}
