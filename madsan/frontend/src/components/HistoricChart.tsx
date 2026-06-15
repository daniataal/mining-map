"use client";

import { useHistoricAggregates, type HistoricPreset, useHistoricRange } from "@/lib/historicRange";

type Props = {
  entityType: string;
  entityId: string;
  metric?: string;
  title?: string;
  valueLabel?: string;
  height?: number;
};

function formatBucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function HistoricChart({
  entityType,
  entityId,
  metric = "signals",
  title = "Historic activity",
  valueLabel = "count",
  height = 96,
}: Props) {
  const { range, setPreset } = useHistoricRange("30d");
  const { data, loading, error } = useHistoricAggregates({
    entityType,
    entityId,
    metric,
    range,
    enabled: !!entityId,
  });

  const buckets = data?.buckets ?? [];
  const maxVal = Math.max(1, ...buckets.map((b) => b.value ?? b.count ?? 0));

  const presets: HistoricPreset[] = ["7d", "30d", "90d", "1y"];

  return (
    <div className="historic-chart">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>{title}</strong>
        <div className="historic-range-bar" style={{ marginBottom: 0 }}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={range.preset === p ? "active" : ""}
              onClick={() => setPreset(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading && <p style={{ fontSize: 11, color: "var(--muted)" }}>Loading aggregates…</p>}
      {error && <p style={{ fontSize: 11, color: "var(--danger)" }}>{error}</p>}

      {!loading && buckets.length === 0 && (
        <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0, fontSize: 11 }}>
          {data?.disclaimer ?? "No historic buckets in range — data appears after Phase A migration."}
          {data?.tier === "stub" ? " (API stub)" : ""}
        </p>
      )}

      {buckets.length > 0 && (
        <svg
          viewBox={`0 0 ${Math.max(buckets.length * 14, 140)} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={title}
          style={{ display: "block" }}
        >
          {buckets.map((b, i) => {
            const val = b.value ?? b.count ?? 0;
            const barH = (val / maxVal) * (height - 20);
            const x = i * 14 + 2;
            const y = height - 12 - barH;
            return (
              <g key={b.bucket_start}>
                <rect
                  x={x}
                  y={y}
                  width={10}
                  height={Math.max(barH, val > 0 ? 2 : 0)}
                  rx={2}
                  fill="var(--accent)"
                  opacity={0.85}
                >
                  <title>
                    {formatBucketLabel(b.bucket_start)}: {val} {valueLabel}
                  </title>
                </rect>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
