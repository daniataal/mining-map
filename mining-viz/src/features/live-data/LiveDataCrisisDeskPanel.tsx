import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, TrendingUp } from 'lucide-react';
import {
  getCorridorDelta,
  getScenarioDigest,
  type OilOpportunity,
} from '../../api/oilLiveApi';
import { useI18n } from '../../lib/i18n';
import CustomsOpenTierBadge from './CustomsOpenTierBadge';

const DEFAULT_SCENARIO = 'hormuz_disruption_v1';

type Props = {
  onOpenOpportunity?: (opp: OilOpportunity) => void;
};

export default function LiveDataCrisisDeskPanel({ onOpenOpportunity }: Props) {
  const { t } = useI18n();

  const { data: digest, isLoading, isError } = useQuery({
    queryKey: ['crisis-digest', DEFAULT_SCENARIO],
    queryFn: () => getScenarioDigest(DEFAULT_SCENARIO),
    staleTime: 60_000,
  });

  const sc = digest?.scenario;
  const hasDigestCorridors = (digest?.top_corridors?.length ?? 0) > 0;
  const { data: delta } = useQuery({
    queryKey: ['corridor-delta', sc?.min_lat, sc?.max_lat],
    queryFn: () =>
      getCorridorDelta({
        min_lat: sc!.min_lat,
        max_lat: sc!.max_lat,
        min_lng: sc!.min_lng,
        max_lng: sc!.max_lng,
        limit: 12,
        commodity: sc?.product_filter ?? undefined,
      }),
    enabled: !!sc && !hasDigestCorridors,
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <p className="text-xs text-slate-500 flex items-center gap-2 p-3">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('טוען שולחן משבר…', 'Loading crisis desk…')}
      </p>
    );
  }

  if (isError || !digest) {
    return (
      <p className="text-xs text-red-500 p-3">
        {t('לא ניתן לטעון תרחיש — הריצו מיגרציות oil-live-intel', 'Cannot load scenario — run oil-live-intel migrations')}
      </p>
    );
  }

  const watchZones = digest.watch_zone_observations_24h ?? [];
  const customsOpen =
    digest.manifest_by_tier?.find((x) => x.bol_tier === 'customs_open')?.count ?? 0;

  return (
    <div className="space-y-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[10px] font-black uppercase text-amber-800 dark:text-amber-200">
            {digest.scenario?.title ?? DEFAULT_SCENARIO}
          </p>
          <p className="text-[10px] text-amber-900/80 dark:text-amber-100/80 mt-1 leading-relaxed">
            {digest.disclaimer}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 p-2">
          <p className="text-lg font-black tabular-nums">{digest.open_opportunity_count ?? 0}</p>
          <p className="text-[9px] font-bold uppercase text-slate-500">
            {t('הזדמנויות פתוחות', 'Open plays')}
          </p>
        </div>
        <div className="rounded-lg border border-black/5 dark:border-white/10 bg-white/80 dark:bg-slate-900/60 p-2">
          <p className="text-lg font-black tabular-nums">{customsOpen}</p>
          <CustomsOpenTierBadge tier="customs_open" className="justify-center mt-1" />
        </div>
      </div>

      {watchZones.length > 0 && (
        <section className="space-y-1">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('כיסוי AIS (24ש)', 'AIS coverage (24h)')}
          </p>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {watchZones.map((z) => (
              <li
                key={z.zone_id}
                className="text-[9px] flex justify-between gap-2 text-slate-600 dark:text-slate-300"
              >
                <span className="truncate">{z.name}</span>
                <span className="shrink-0 tabular-nums">
                  {z.observation_count}
                  {z.has_gap ? ' · gap' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(digest.top_corridors?.length ?? 0) > 0 && (
        <section className="space-y-1">
          <p className="text-[9px] font-black uppercase text-slate-500 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {t('מסדרונות מובילים בתרחיש', 'Top corridors in scenario')}
          </p>
          <ul className="space-y-1">
            {digest.top_corridors!.slice(0, 6).map((c) => (
              <li
                key={`${c.load_country}-${c.discharge_country}-${c.commodity_family}`}
                className="text-[9px] text-slate-600 dark:text-slate-300"
              >
                {c.load_country} → {c.discharge_country} · {c.commodity_family} ({c.cargo_count})
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasDigestCorridors && (delta?.corridors?.length ?? 0) > 0 && (
        <section className="space-y-1">
          <p className="text-[9px] font-black uppercase text-slate-500 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            {t('מסדרונות עולים (90d)', 'Rising corridors')}
          </p>
          <ul className="space-y-1">
            {delta!.corridors!.slice(0, 6).map((c) => (
              <li
                key={`${c.load_country}-${c.discharge_country}-${c.commodity_family}`}
                className="text-[9px] text-slate-600 dark:text-slate-300"
              >
                {c.load_country} → {c.discharge_country} · {c.commodity_family} (+{c.delta_count})
              </li>
            ))}
          </ul>
        </section>
      )}

      {(digest.top_opportunities?.length ?? 0) > 0 && (
        <section className="space-y-1">
          <p className="text-[9px] font-black uppercase text-slate-500">
            {t('הצעות מובילות', 'Top plays')}
          </p>
          {digest.top_opportunities!.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left rounded-lg border border-black/5 dark:border-white/10 p-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
              onClick={() =>
                onOpenOpportunity?.({
                  id: o.id,
                  title: o.title,
                  confidence: o.deal_score,
                } as OilOpportunity)
              }
            >
              <p className="text-[10px] font-semibold text-slate-900 dark:text-white line-clamp-1">
                {o.title}
              </p>
              <p className="text-[9px] text-slate-500">
                {Math.round((o.deal_score ?? 0) * 100)}% · {o.signal_kind ?? 'signal'}
              </p>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
