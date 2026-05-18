import { useI18n } from '../../lib/i18n';
import {
  ROUTE_LEGEND_ORDER,
  ROUTE_METHOD_STYLES,
  type NormalizedRouteMethod,
} from './routeMapStyles';

function LegendSwatch({ method }: { method: NormalizedRouteMethod }) {
  const style = ROUTE_METHOD_STYLES[method];
  const dashed = style.legendLine === 'dashed';
  return (
    <span
      className="inline-block h-0 w-8 shrink-0 border-t-2 align-middle"
      style={{
        borderColor: style.color,
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
      aria-hidden
    />
  );
}

interface RouteLegendProps {
  className?: string;
  compact?: boolean;
}

export default function RouteLegend({ className = '', compact = false }: RouteLegendProps) {
  const { t } = useI18n();

  return (
    <div
      className={`pointer-events-none select-none rounded-xl border border-black/10 bg-white/92 px-3 py-2 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-slate-950/92 ${className}`}
      aria-label={t('מקרא מסלול', 'Route legend')}
    >
      <p className="mb-1.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
        {t('מקרא מסלול', 'Route legend')}
      </p>
      <ul className={`space-y-1 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
        {ROUTE_LEGEND_ORDER.map((method) => {
          const style = ROUTE_METHOD_STYLES[method];
          const legendHint =
            method === 'sea'
              ? t('כחול מקווקו = ים', 'Blue dashed = sea')
              : method === 'air'
                ? t('סגול מקווקו = אוויר', 'Purple dashed = air')
                : method === 'rail'
                  ? t('ירוק מקווקו = רכבת', 'Green dashed = rail')
                  : t('ענבר רציף = כביש', 'Amber solid = road');
          return (
            <li key={method} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <LegendSwatch method={method} />
              <span className="text-base leading-none" aria-hidden>
                {style.icon}
              </span>
              <span className="font-semibold">
                {t(style.labelHe, style.labelEn)}
                {!compact && <span className="ml-1 font-normal text-slate-500">· {legendHint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
