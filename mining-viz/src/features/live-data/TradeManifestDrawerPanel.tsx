import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getTradeManifests, type TradeManifestRow } from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import CustomsOpenTierBadge from './CustomsOpenTierBadge';

type Props = {
  manifestId: string;
  title?: string;
};

function ManifestBody({ row }: { row: TradeManifestRow }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <CustomsOpenTierBadge tier={row.bol_tier} />
        {row.data_source && (
          <span className="text-[9px] font-bold uppercase text-slate-400">{row.data_source}</span>
        )}
      </div>
      <p className="text-[10px] text-amber-800 dark:text-amber-200 leading-relaxed">
        {t(
          'שורות מכס פתוחות (HMRC ודומה) — לא Bill of Lading בתשלום.',
          'Open customs rows (HMRC-style) — not a paid Bill of Lading.',
        )}
      </p>
      <dl className="grid grid-cols-1 gap-2">
        <div>
          <dt className="text-[9px] font-black uppercase text-slate-400">
            {t('יבואן', 'Importer')}
          </dt>
          <dd className="font-semibold text-slate-900 dark:text-white">
            {row.importer_name ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] font-black uppercase text-slate-400">
            {t('יצואן', 'Exporter')}
          </dt>
          <dd className="font-semibold text-slate-900 dark:text-white">
            {row.exporter_name ?? '—'}
          </dd>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-[9px] font-black uppercase text-slate-400">
              {t('שותף', 'Partner')}
            </dt>
            <dd>{row.partner_country ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[9px] font-black uppercase text-slate-400">HS</dt>
            <dd>{row.hs_code ?? '—'}</dd>
          </div>
        </div>
        {(row.commodity_family || row.product_description) && (
          <div>
            <dt className="text-[9px] font-black uppercase text-slate-400">
              {t('מוצר', 'Product')}
            </dt>
            <dd>
              {[row.commodity_family, row.product_description].filter(Boolean).join(' · ')}
            </dd>
          </div>
        )}
        {(row.period_year != null || row.value_usd != null) && (
          <div className="grid grid-cols-2 gap-2">
            {row.period_year != null && (
              <div>
                <dt className="text-[9px] font-black uppercase text-slate-400">
                  {t('שנה', 'Year')}
                </dt>
                <dd>{row.period_year}</dd>
              </div>
            )}
            {row.value_usd != null && (
              <div>
                <dt className="text-[9px] font-black uppercase text-slate-400">
                  {t('ערך USD', 'Value USD')}
                </dt>
                <dd>{row.value_usd.toLocaleString()}</dd>
              </div>
            )}
          </div>
        )}
      </dl>
      {row.source_record_url && (
        <a
          href={row.source_record_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-sky-600"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {t('אמת במקור', 'Verify at source')}
        </a>
      )}
    </div>
  );
}

export default function TradeManifestDrawerPanel({ manifestId, title }: Props) {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['oil-live-trade-manifest', manifestId],
    queryFn: async () => {
      const res = await getTradeManifests({ limit: 500 });
      const row = res.manifests?.find((m) => m.id === manifestId);
      if (!row) throw new Error('Manifest not found');
      return row;
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-violet-500" />
        <p className="text-[9px] font-black uppercase text-violet-600">
          {t('מניפסט פתוח', 'Open manifest')}
        </p>
      </div>
      <p className="font-semibold text-slate-900 dark:text-white">
        {title ?? data?.importer_name ?? data?.exporter_name ?? manifestId.slice(0, 8)}
      </p>
      {isLoading && (
        <p className="text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('טוען מניפסט…', 'Loading manifest…')}
        </p>
      )}
      {isError && (
        <p className="text-red-500 text-[10px]">
          {error instanceof Error ? error.message : 'Failed to load manifest'}
        </p>
      )}
      {data && <ManifestBody row={data} />}
    </div>
  );
}
