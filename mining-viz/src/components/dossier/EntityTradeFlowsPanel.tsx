import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import TradeFlowsChart from './TradeFlowsChart';

interface StoredTradeFlow {
  reporter?: string;
  partner?: string;
  hs_code?: string;
  flow_type?: string;
  year?: number;
  trade_value_usd?: number | null;
  data_source?: string;
}

interface EntityTradeFlowsResponse {
  entityId: string;
  country?: string;
  commodity?: string;
  hsCodes?: string[];
  flows?: StoredTradeFlow[];
  flowCount?: number;
  provenance?: string;
  limitations?: string[];
  warnings?: string[];
}

function fmtUsd(val: number | null | undefined): string {
  if (val == null) return 'N/A';
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

interface EntityTradeFlowsPanelProps {
  entityId: string;
  entityKind?: string;
}

export default function EntityTradeFlowsPanel({
  entityId,
  entityKind = 'license',
}: EntityTradeFlowsPanelProps) {
  const { t } = useI18n();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['entity-trade-flows', entityId, entityKind],
    queryFn: async () => {
      const { data: body } = await apiClient.get<EntityTradeFlowsResponse>(
        `/entities/${encodeURIComponent(entityId)}/trade-flows`,
        { params: { entity_kind: entityKind, limit: 40 } },
      );
      return body;
    },
    enabled: Boolean(entityId),
    staleTime: 30 * 60_000,
  });

  if (isLoading) {
    return (
      <Card className="p-4 text-xs text-slate-500">
        {t('טוען זרימות סחר מ-Comtrade…', 'Loading stored Comtrade trade flows…')}
      </Card>
    );
  }

  if (isError || !data) return null;

  const flows = data.flows || [];
  const warnings = data.warnings || [];

  if (!flows.length) {
    return (
      <Card className="p-4 space-y-2 border-amber-500/25 bg-amber-500/5">
        <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
          {t('זרימות סחר (מאקרו)', 'Trade flows (macro)')}
        </p>
        <Badge variant="outline" className="text-[10px] uppercase">
          {t('רמת מאקרו', 'bol_tier: macro')}
        </Badge>
        {warnings.map((w, i) => (
          <p key={i} className="text-xs text-slate-600 dark:text-slate-400">
            {w}
          </p>
        ))}
        <p className="text-[11px] text-slate-500">
          {t(
            'הריצו graph-sync כדי למלא Comtrade וזרימות מוצרי מדף.',
            'Run graph-sync to populate Comtrade and commodity_trade_flows.',
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3 border-amber-500/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('זרימות סחר (Comtrade DB)', 'Trade flows (Comtrade DB)')}
          </p>
          {data.country && (
            <p className="text-[10px] text-slate-500">
              {data.country} · HS {(data.hsCodes || []).join(', ') || '—'}
            </p>
          )}
        </div>
        <Badge variant="outline" className="text-[9px] font-black uppercase">
          {data.flowCount ?? flows.length} rows
        </Badge>
      </div>
      {data.warnings?.map((w) => (
        <p key={w} className="text-[10px] text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
      {flows.length > 0 && <TradeFlowsChart flows={flows} />}
      {flows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500 uppercase tracking-wider">
                <th className="py-1 pr-2">Year</th>
                <th className="py-1 pr-2">Flow</th>
                <th className="py-1 pr-2">HS</th>
                <th className="py-1 pr-2">Partner</th>
                <th className="py-1">USD</th>
              </tr>
            </thead>
            <tbody>
              {flows.slice(0, 15).map((row, i) => (
                <tr
                  key={`${row.year}-${row.partner}-${i}`}
                  className="border-t border-black/5 dark:border-white/5"
                >
                  <td className="py-1 pr-2">{row.year}</td>
                  <td className="py-1 pr-2">
                    {row.flow_type === 'X' ? 'Export' : row.flow_type === 'M' ? 'Import' : row.flow_type}
                  </td>
                  <td className="py-1 pr-2">{row.hs_code}</td>
                  <td className="py-1 pr-2">{row.partner || '—'}</td>
                  <td className="py-1">{fmtUsd(row.trade_value_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.provenance && <p className="text-[10px] text-slate-500">{data.provenance}</p>}
    </Card>
  );
}
