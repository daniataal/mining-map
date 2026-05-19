import { motion } from 'framer-motion';

interface TradeFlowRow {
  year?: number;
  flow_type?: string;
  trade_value_usd?: number | null;
}

interface TradeFlowsChartProps {
  flows: TradeFlowRow[];
}

function aggregateByYear(flows: TradeFlowRow[]): { year: number; exportUsd: number; importUsd: number }[] {
  const byYear = new Map<number, { exportUsd: number; importUsd: number }>();
  for (const row of flows) {
    const year = row.year;
    if (year == null) continue;
    const val = row.trade_value_usd ?? 0;
    const entry = byYear.get(year) ?? { exportUsd: 0, importUsd: 0 };
    if (row.flow_type === 'X') entry.exportUsd += val;
    else if (row.flow_type === 'M') entry.importUsd += val;
    byYear.set(year, entry);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, vals]) => ({ year, ...vals }));
}

function fmtShortUsd(val: number): string {
  if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
  if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(0)}M`;
  if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
  return String(Math.round(val));
}

export default function TradeFlowsChart({ flows }: TradeFlowsChartProps) {
  const series = aggregateByYear(flows);
  if (series.length < 2) return null;

  const maxVal = Math.max(1, ...series.flatMap((s) => [s.exportUsd, s.importUsd]));
  const chartW = 280;
  const chartH = 72;
  const barW = Math.min(24, Math.max(8, chartW / (series.length * 2.5)));

  return (
    <motion.div className="space-y-2">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
        Trade value by year (stored Comtrade)
      </p>
      <svg
        viewBox={`0 0 ${chartW} ${chartH + 16}`}
        className="w-full max-w-md h-auto text-slate-600 dark:text-slate-300"
        role="img"
        aria-label="Export and import trade values by year"
      >
        {series.map((point, i) => {
          const x = 8 + i * (barW * 2 + 6);
          const exportH = (point.exportUsd / maxVal) * chartH;
          const importH = (point.importUsd / maxVal) * chartH;
          return (
            <g key={point.year}>
              <rect
                x={x}
                y={chartH - exportH}
                width={barW}
                height={Math.max(exportH, 1)}
                className="fill-amber-500/80"
                rx={1}
              />
              <rect
                x={x + barW + 2}
                y={chartH - importH}
                width={barW}
                height={Math.max(importH, 1)}
                className="fill-sky-500/70"
                rx={1}
              />
              <text x={x + barW} y={chartH + 12} textAnchor="middle" className="fill-current text-[8px]">
                {point.year}
              </text>
            </g>
          );
        })}
      </svg>
      <motion.div className="flex gap-4 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-amber-500/80" />
          Export
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-sky-500/70" />
          Import
        </span>
        <span className="ml-auto font-mono">max {fmtShortUsd(maxVal)}</span>
      </motion.div>
    </motion.div>
  );
}
