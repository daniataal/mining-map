"use client";

/**
 * Storage site estimate panel — bounded inventory estimate from open data
 * (OSM tank counts × typical tank sizes × EIA utilization band). Always shown
 * as a range with method and confidence; never a measurement.
 */
import type { MapSelection } from "@/components/EntityDossierPanel";

type Props = {
  selection: MapSelection;
};

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtBbl(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M bbl`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k bbl`;
  return `${Math.round(v)} bbl`;
}

export default function StorageSitePanel({ selection }: Props) {
  const props = selection as Record<string, unknown>;
  const tankCount = asNum(props.tank_count);
  const capLow = asNum(props.capacity_bbl_low);
  const capHigh = asNum(props.capacity_bbl_high);
  const invLow = asNum(props.inventory_bbl_low);
  const invHigh = asNum(props.inventory_bbl_high);
  const fillLow = asNum(props.fill_rate_low);
  const fillHigh = asNum(props.fill_rate_high);
  const confidence = String(props.confidence ?? "inferred");
  const country = props.country_code ? String(props.country_code) : "";

  return (
    <div>
      <h3 style={{ margin: "0 0 2px" }}>{String(props.name ?? "Storage site")}</h3>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 10px" }}>
        Tank storage site{country ? ` · ${country}` : ""} ·{" "}
        <span className={`badge ${confidence === "inferred" ? "partial" : "warn"}`}>{confidence} estimate</span>
      </p>

      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "4px 0", color: "var(--muted)" }}>Tanks observed (OSM)</td>
            <td style={{ textAlign: "right", fontWeight: 600 }}>{tankCount ?? "—"}</td>
          </tr>
          <tr>
            <td style={{ padding: "4px 0", color: "var(--muted)" }}>Capacity (est. range)</td>
            <td style={{ textAlign: "right", fontWeight: 600 }}>
              {fmtBbl(capLow)} – {fmtBbl(capHigh)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "4px 0", color: "var(--muted)" }}>Assumed fill rate</td>
            <td style={{ textAlign: "right", fontWeight: 600 }}>
              {fillLow != null && fillHigh != null ? `${Math.round(fillLow * 100)}–${Math.round(fillHigh * 100)}%` : "—"}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "4px 0", color: "var(--muted)" }}>Product in tanks (est.)</td>
            <td style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)" }}>
              {fmtBbl(invLow)} – {fmtBbl(invHigh)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 12, padding: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
        <strong style={{ color: "var(--text)" }}>How this is estimated</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
          <li>Tank count is real observed data (OpenStreetMap, ODbL).</li>
          <li>Per-tank size uses industry-typical bands by site scale (5k–150k bbl).</li>
          <li>Fill rate anchors to the EIA working-storage utilization band (55–75%); non-US sites reuse the band as a heuristic with lower confidence.</li>
        </ul>
      </div>

      <p className="disclaimer" style={{ marginTop: 10 }}>
        Bounded estimate from open data — not a measured inventory. Satellite floating-roof analysis can tighten these bands later.
      </p>
    </div>
  );
}
