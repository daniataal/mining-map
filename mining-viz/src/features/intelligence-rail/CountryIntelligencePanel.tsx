import { useQuery } from '@tanstack/react-query';
import { LucideBuilding2, LucideGlobe2, LucideTrendingUp } from 'lucide-react';
import { fetchCountryIntelligence } from '../../api/countryIntelligenceApi';
import { useI18n } from '../../lib/i18n';

type Props = {
  country: string;
  onViewAssets?: (country: string) => void;
  onFindSuppliers?: (country: string) => void;
  onBuildDealPack?: (country: string) => void;
};

export function CountryIntelligencePanel({
  country,
  onViewAssets,
  onFindSuppliers,
  onBuildDealPack,
}: Props) {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['country-intelligence', country],
    queryFn: () => fetchCountryIntelligence(country),
    staleTime: 60_000,
    enabled: Boolean(country.trim()),
  });

  if (isLoading) {
    return (
      <p className="text-sm text-slate-500 animate-pulse">
        {t('טוען מודיעין מדינה…', 'Loading country intelligence…')}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-red-500">
        {error instanceof Error ? error.message : t('שגיאה', 'Error')}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-black tracking-tight flex items-center gap-2">
          <LucideGlobe2 className="w-5 h-5 text-cyan-500" />
          {data.country}
        </h3>
        <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">
          {data.data_tier.replace(/_/g, ' ')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label={t('נכסים במפה', 'Map assets')}
          value={String(data.license_counts.map_visible_count ?? data.license_counts.total)}
          sub={
            data.license_counts.stored_total_count != null &&
            data.license_counts.stored_total_count !==
              (data.license_counts.map_visible_count ?? data.license_counts.total)
              ? `${data.license_counts.stored_total_count} stored · ${data.license_counts.coordinate_valid_count ?? '—'} mappable`
              : `${data.license_counts.mining} mining · ${data.license_counts.oil_and_gas} O&G`
          }
        />
        <StatCard label={t('נמלים', 'Ports')} value={String(data.port_count)} />
        <StatCard
          label={t('כלי שיט (מאגר)', 'Vessels (store)')}
          value={data.vessel_count != null ? String(data.vessel_count) : '—'}
          sub={data.vessel_coverage_note ?? undefined}
        />
        <StatCard
          label={t('אותות מסחר', 'Trade signals')}
          value={String(data.trade_signals.length)}
        />
      </div>

      {data.top_operators.length > 0 && (
        <section>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
            <LucideBuilding2 className="w-3.5 h-3.5" />
            {t('מפעילים מובילים', 'Top operators')}
          </h4>
          <ul className="space-y-1.5">
            {data.top_operators.map((op) => (
              <li
                key={`${op.company}-${op.sector}`}
                className="flex justify-between text-xs font-semibold border-b border-black/5 dark:border-white/5 pb-1"
              >
                <span className="truncate pr-2">{op.company}</span>
                <span className="text-slate-500 shrink-0">
                  {op.count} · {op.sector}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.trade_signals.length > 0 && (
        <section>
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
            <LucideTrendingUp className="w-3.5 h-3.5" />
            {t('אותות מסחר', 'Trade signals')}
          </h4>
          <ul className="space-y-1">
            {data.trade_signals.map((sig) => (
              <li key={sig.label} className="text-xs">
                <span className="font-bold">{sig.label}</span>
                <span className="text-slate-500"> — {sig.value}</span>
                <span className="ml-1 text-[9px] uppercase text-amber-600">({sig.tier})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[10px] leading-snug text-slate-500 border-t border-black/5 dark:border-white/5 pt-3">
        {data.license_counts.count_explanation ? `${data.license_counts.count_explanation} ` : ''}
        {data.disclaimer}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        {onViewAssets && (
          <ActionButton label={t('צפה בנכסים', 'View Assets')} onClick={() => onViewAssets(country)} />
        )}
        {onFindSuppliers && (
          <ActionButton
            label={t('מצא ספקים', 'Find Suppliers')}
            onClick={() => onFindSuppliers(country)}
          />
        )}
        {onBuildDealPack && (
          <ActionButton
            label={t('בנה Deal Pack', 'Build Deal Pack')}
            primary
            onClick={() => onBuildDealPack(country)}
          />
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white/50 dark:bg-slate-950/50 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className="text-xl font-black mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-slate-500 mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
        primary
          ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
          : 'border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );
}
