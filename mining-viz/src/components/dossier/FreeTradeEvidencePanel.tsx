import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Ship, TrendingUp } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { MiningLicense } from '../../types';
import { apiClient, useMaritimeContext } from '../../lib/api';
import {
  buildTradeEvidenceLinks,
  summarizeTradePartners,
  tradeEvidenceHasData,
} from '../../lib/tradeEvidenceLinks';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import TradeFlowsChart from './TradeFlowsChart';

interface StoredTradeFlow {
  partner?: string;
  flow_type?: string;
  hs_code?: string;
  year?: number;
  trade_value_usd?: number | null;
}

interface EntityTradeFlowsResponse {
  country?: string;
  commodity?: string;
  hsCodes?: string[];
  flows?: StoredTradeFlow[];
  flowCount?: number;
  warnings?: string[];
  limitations?: string[];
  provenance?: string;
}

function fmtUsd(val: number | null | undefined): string {
  if (val == null) return '—';
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

interface FreeTradeEvidencePanelProps {
  item: MiningLicense;
  commodityLabel: string;
  onOpenExportsTab?: () => void;
}

function PartnerTable({
  title,
  rows,
}: {
  title: string;
  rows: ReturnType<typeof summarizeTradePartners>['imports'];
}) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-slate-500 uppercase tracking-wider">
              <th className="py-1 pr-2">Partner</th>
              <th className="py-1 pr-2">HS</th>
              <th className="py-1">USD (agg.)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.partner}`} className="border-t border-black/5 dark:border-white/5">
                <td className="py-1 pr-2 font-semibold text-slate-800 dark:text-slate-200">{row.partner}</td>
                <td className="py-1 pr-2">{row.hsCodes.slice(0, 3).join(', ') || '—'}</td>
                <td className="py-1">{fmtUsd(row.totalUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FreeTradeEvidencePanel({
  item,
  commodityLabel,
  onOpenExportsTab,
}: FreeTradeEvidencePanelProps) {
  const { t } = useI18n();
  const entityKind = item.entityKind || 'license';

  const { data: tradeData, isLoading: tradeLoading } = useQuery({
    queryKey: ['entity-trade-flows', item.id, entityKind],
    queryFn: async () => {
      const { data } = await apiClient.get<EntityTradeFlowsResponse>(
        `/entities/${encodeURIComponent(item.id)}/trade-flows`,
        { params: { entity_kind: entityKind, limit: 40 } },
      );
      return data;
    },
    enabled: Boolean(item.id),
    staleTime: 30 * 60_000,
  });

  const flows = tradeData?.flows || [];
  const { imports, exports } = useMemo(() => summarizeTradePartners(flows), [flows]);
  const deepLinks = useMemo(
    () =>
      buildTradeEvidenceLinks({
        country: tradeData?.country || item.country,
        commodity: tradeData?.commodity || commodityLabel,
        hsCodes: tradeData?.hsCodes,
      }),
    [tradeData, item.country, commodityLabel],
  );

  const hasCoords = item.lat != null && item.lng != null && !Number.isNaN(item.lat) && !Number.isNaN(item.lng);
  const maritimeEnabled = Boolean(
    (item.company || '').trim() ||
    (item.country || '').trim() ||
    hasCoords,
  );

  const { data: maritime, isLoading: maritimeLoading } = useMaritimeContext(
    {
      company: item.company,
      country: item.country,
      commodity: commodityLabel,
      lat: item.lat,
      lng: item.lng,
    },
    maritimeEnabled,
  );

  const hasMaritimeData = Boolean(
    maritime &&
    (maritime.nearest_ports?.length ||
      maritime.counterparty_proxies?.length ||
      maritime.bol_coverage_note),
  );

  const showEmpty =
    !tradeLoading &&
    !maritimeLoading &&
    flows.length === 0 &&
    !tradeEvidenceHasData({ flowCount: 0, hasMaritime: hasMaritimeData, country: item.country });

  const showPartialEmpty = !tradeLoading && flows.length === 0 && !showEmpty;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
        {t(
          'ראיות סחר חינמיות — לא תעודת משלוח (BOL). נתוני BOL ברמת משלוח דורשים נתוני מכס בתשלום.',
          'Free trade evidence — not bill of lading. Shipment-level BOL requires paid customs data.',
        )}
      </div>

      {/* Comtrade DB section */}
      <Card className="p-6 space-y-4 border-amber-500/20 rounded-3xl">
        <div className="flex items-center gap-2 flex-wrap">
          <TrendingUp className="h-4 w-4 text-amber-500" />
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('זרימות סחר (Comtrade DB)', 'Comtrade (stored in DB)')}
          </h4>
          <Badge variant="outline" className="text-[9px] font-black uppercase ml-auto">
            {tradeData?.flowCount ?? flows.length} rows
          </Badge>
        </div>
        <p className="text-[10px] text-slate-500">
          {t(
            'שותפי יבוא/יצוא ברמת מדינה מ-UN Comtrade — לא שם משלח/נמען לכל מטען.',
            'Country-level import/export partners from UN Comtrade — not per-cargo shipper/consignee names.',
          )}
        </p>

        {tradeLoading && (
          <p className="text-sm text-slate-500">{t('טוען זרימות סחר…', 'Loading trade flows…')}</p>
        )}

        {!tradeLoading && flows.length > 0 && (
          <>
            {(tradeData?.country || tradeData?.hsCodes?.length) && (
              <p className="text-[10px] text-slate-500">
                {tradeData?.country}
                {tradeData?.hsCodes?.length ? ` · HS ${tradeData.hsCodes.join(', ')}` : ''}
              </p>
            )}
            <TradeFlowsChart flows={flows} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <PartnerTable title={t('יבוא — שותפים מובילים', 'Top import partners')} rows={imports} />
              <PartnerTable title={t('יצוא — שותפים מובילים', 'Top export partners')} rows={exports} />
            </div>
          </>
        )}

        {showPartialEmpty && (
          <p className="text-[11px] text-slate-500">
            {t(
              'אין שורות Comtrade שמורות לישות זו. השתמש בקישורים החיצוניים או הפעל סנכרון.',
              'No stored Comtrade rows for this entity. Use external links below or run sync.',
            )}
          </p>
        )}

        {(tradeData?.warnings || []).map((w) => (
          <p key={w} className="text-[10px] text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
        {tradeData?.provenance && (
          <p className="text-[10px] text-slate-500">{tradeData.provenance}</p>
        )}
      </Card>

      {/* Maritime proxy */}
      <Card className="p-6 space-y-4 rounded-3xl border-cyan-500/20">
        <div className="flex items-center gap-2">
          <Ship className="h-4 w-4 text-cyan-500" />
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('פרוקסי ימי (נתונים פתוחים)', 'Maritime proxy (open data)')}
          </h4>
        </div>

        {!maritimeEnabled && (
          <p className="text-[11px] text-slate-500">
            {t('חסרים מדינה/חברה/קואורדינטות לשאילתת ימי.', 'Need country, company, or coordinates for maritime context.')}
          </p>
        )}

        {maritimeLoading && maritimeEnabled && (
          <p className="text-sm text-slate-500">{t('טוען הקשר ימי…', 'Loading maritime context…')}</p>
        )}

        {!maritimeLoading && maritime && (
          <>
            {maritime.nearest_ports.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {t('נמלים קרובים', 'Nearest ports')}
                </p>
                {maritime.nearest_ports.slice(0, 4).map((port) => (
                  <div
                    key={`${port.unlocode || port.name}-${port.lat}`}
                    className="rounded-xl border border-black/5 dark:border-white/5 px-3 py-2 text-[11px]"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200">{port.name}</span>
                    <span className="text-slate-500 ml-2">
                      {[port.unlocode, port.country_iso2].filter(Boolean).join(' · ')}
                      {port.distance_km != null ? ` · ${Math.round(port.distance_km)} km` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {maritime.counterparty_proxies.slice(0, 3).map((proxy) => (
              <div key={proxy.id} className="rounded-xl border border-black/5 dark:border-white/5 px-3 py-2">
                <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{proxy.label}</p>
                <p className="text-[10px] text-slate-500">{proxy.description}</p>
                {proxy.url && (
                  <a
                    href={proxy.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-[9px] font-black uppercase text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    {t('מקור', 'Source')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-slate-600 dark:text-slate-300">
              {maritime.bol_coverage_note}
            </div>
          </>
        )}

        {!maritimeLoading && maritimeEnabled && !hasMaritimeData && (
          <p className="text-[11px] text-slate-500">
            {t(
              'אין נמלים או פרוקסי ימי — נסה מצב נפט וגז או ודא קואורדינטות.',
              'No ports or maritime proxies returned — oil & gas mode or coordinates help.',
            )}
          </p>
        )}
      </Card>

      {/* External deep links */}
      <Card className="p-6 space-y-3 rounded-3xl">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-indigo-500" />
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('מקורות חיצוניים (ללא מפתח)', 'External sources (no API key)')}
          </h4>
        </div>
        <div className="space-y-2">
          {deepLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-2xl border border-black/5 dark:border-white/5 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <div className="min-w-0 pr-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-800 dark:text-slate-200">
                  {link.label}
                </p>
                <p className="text-[9px] text-slate-500 mt-0.5">{link.description}</p>
              </div>
              <ExternalLink className="h-4 w-4 text-slate-400 shrink-0" />
            </a>
          ))}
        </div>
      </Card>

      {showEmpty && (
        <Card className="p-8 text-center space-y-4 border-dashed border-amber-500/30">
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            {t(
              'אין עדיין ראיות סחר שמורות לרישיון זה.',
              'No stored trade evidence for this license yet.',
            )}
          </p>
          <p className="text-[11px] text-slate-500">
            {t(
              'הגדר COMTRADE_API_KEY ב-.env והפעל סנכרון Comtrade במנהל. בדוק גם יבוא/יצוא.',
              'Set COMTRADE_API_KEY in .env and run Comtrade sync in Admin. Also check Exports & Imports.',
            )}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {onOpenExportsTab && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenExportsTab}>
                {t('יבוא/יצוא', 'Exports & Imports')}
              </Button>
            )}
          </div>
        </Card>
      )}

      <p className="text-[10px] text-slate-500 leading-relaxed">
        {t(
          'מגבלות: אין שמות משלח/נמען per shipment, אין משקל מטען per BOL, אין DUNS מומצא. Comtrade = סחר ברמת מדינה; ימי = נמלים ופרוקסי AIS/חדשות.',
          'Limitations: no per-shipment shipper/consignee, no per-BOL cargo weight, no fabricated DUNS. Comtrade = country-level trade; maritime = ports and open AIS/news proxies.',
        )}
      </p>
    </div>
  );
}
