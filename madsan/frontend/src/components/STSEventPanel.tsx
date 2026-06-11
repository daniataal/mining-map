"use client";

import type { ReactNode } from "react";
import type { MapSelection } from "@/components/EntityDossierPanel";
import { confidenceTierClass } from "@/lib/confidenceTier";
import { formatStsWhen, stsEventKindLabel } from "@/lib/stsDisplay";

type Props = {
  selection: MapSelection;
  onNavigate?: (selection: MapSelection) => void;
};

function vesselRow(
  label: string,
  name?: string,
  mmsi?: string,
  vesselClass?: string,
  onNavigate?: (selection: MapSelection) => void,
) {
  const display = name?.trim() || (mmsi ? `MMSI ${mmsi}` : "Unknown vessel");
  return (
    <div className="dossier-dl-row" style={{ display: "block", marginBottom: 10 }}>
      <dt style={{ marginBottom: 4 }}>{label}</dt>
      <dd>
        <button
          type="button"
          className="linkish"
          style={{ background: "none", border: 0, color: "var(--accent)", cursor: mmsi ? "pointer" : "default", padding: 0, font: "inherit" }}
          disabled={!mmsi}
          onClick={() => mmsi && onNavigate?.({ mmsi, name: display, _entityType: "vessel", _layer: "vessels" })}
        >
          {display}
        </button>
        {vesselClass ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Class: {vesselClass.replace(/_/g, " ")}</div> : null}
      </dd>
    </div>
  );
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function contextText(value: unknown): string | null {
  if (!value) return null;
  let v = value;
  if (typeof value === "string") {
    try {
      v = JSON.parse(value);
    } catch {
      return value.trim() || null;
    }
  }
  if (typeof v !== "object" || v == null) return null;
  const m = v as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name : "";
  const kind = typeof m.kind === "string" ? m.kind.replace(/_/g, " ") : "";
  const distance = num(m.distance_m);
  const parts = [name || kind].filter(Boolean);
  if (distance != null && distance > 0) parts.push(`${(distance / 1000).toFixed(1)} km`);
  return parts.length ? parts.join(" · ") : null;
}

function reasonList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {
      return value.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function metricRow(label: string, value?: ReactNode) {
  if (value == null || value === "") return null;
  return (
    <span className="dossier-dl-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </span>
  );
}

function PredictionPanel({ selection }: { selection: MapSelection }) {
  const pairProbability = num(selection.future_pair_probability);
  const horizon = selection.horizon_hours ?? 24;
  const title = selection.name || selection.event_title || "Probable STS pair";
  const maritimeContext = contextText(selection.maritime_context);
  const terminalContext = contextText(selection.nearest_oil_terminal);
  const mainScore = pairProbability ?? num(selection.confidence_score);

  return (
    <div className="dossier-tabbed">
      <div className="dossier-head">
        <h3 className="dossier-title">{title}</h3>
        <div className="dossier-head-badges">
          <span className="badge compact">STS pair prediction</span>
          {mainScore != null && (
            <span className={`badge compact ${confidenceTierClass(mainScore, selection.review_tier || selection.tier)}`}>
              prob {Math.round(mainScore)}
            </span>
          )}
          <span className="badge compact">{horizon}h</span>
        </div>
      </div>

      <dl className="dossier-dl">
        {vesselRow("Vessel A", selection.vessel_a_name, selection.mmsi_a, selection.vessel_a_class)}
        {vesselRow("Vessel B", selection.vessel_b_name, selection.mmsi_b, selection.vessel_b_class)}
        {metricRow("Pair probability", mainScore != null ? `${Math.round(mainScore)} / 100` : undefined)}
        {metricRow("Horizon", `${horizon} hours`)}
        {metricRow("Pair distance", selection.distance_m != null ? `${Number(selection.distance_m).toFixed(0)} m` : undefined)}
        {metricRow("AIS pair point", selection.event_lat != null && selection.event_lon != null ? `${Number(selection.event_lat).toFixed(5)}, ${Number(selection.event_lon).toFixed(5)}` : undefined)}
        {metricRow("Context", selection.context_label?.replace(/_/g, " "))}
        {metricRow("Anchorage / port", maritimeContext)}
        {metricRow("Petroleum facility", terminalContext)}
        {metricRow("Predicted", formatStsWhen(selection.predicted_at, undefined, selection.observed_at))}
        {metricRow("Expires", selection.expires_at ? formatStsWhen(selection.expires_at) : undefined)}
      </dl>

      <p className="disclaimer" style={{ marginTop: 12 }}>
        {selection.disclaimer ||
          "STS prediction points are likely vessel-pair candidates at recent AIS midpoint locations. They are not confirmed transfers."}
      </p>
    </div>
  );
}

export default function STSEventPanel({ selection, onNavigate }: Props) {
  if (selection._layer === "sts-predictions") {
    return <PredictionPanel selection={selection} />;
  }

  const transferProbability = num(selection.transfer_probability ?? selection.confidence_score);
  const proximityScore = num(selection.proximity_score);
  const cargoConfidence = num(selection.cargo_confidence);
  const title = selection.name || selection.event_title || "STS event";
  const kind = stsEventKindLabel(selection.event_kind);
  const when = formatStsWhen(selection.start_ts, selection.end_ts, selection.observed_at);
  const maritimeContext = contextText(selection.maritime_context);
  const terminalContext = contextText(selection.nearest_oil_terminal);
  const reasons = reasonList(selection.downgrade_reasons);

  return (
    <div className="dossier-tabbed">
      <div className="dossier-head">
        <h3 className="dossier-title">{title}</h3>
        <div className="dossier-head-badges">
          <span className="badge compact">{kind}</span>
          {transferProbability != null && transferProbability > 0 && (
            <span className={`badge compact ${confidenceTierClass(transferProbability, selection.review_tier || selection.tier)}`}>
              prob {Math.round(transferProbability)}
            </span>
          )}
          {selection.review_tier ? <span className="badge compact">{selection.review_tier}</span> : null}
        </div>
      </div>

      <dl className="dossier-dl">
        {vesselRow("Vessel A", selection.vessel_a_name, selection.mmsi_a, selection.vessel_a_class, onNavigate)}
        {vesselRow("Vessel B", selection.vessel_b_name, selection.mmsi_b, selection.vessel_b_class, onNavigate)}
        <span className="dossier-dl-row">
          <dt>When</dt>
          <dd>{when}</dd>
        </span>
        {selection.zone_name ? (
          <span className="dossier-dl-row">
            <dt>Zone</dt>
            <dd>{selection.zone_name}</dd>
          </span>
        ) : null}
        {selection.min_distance_m != null && selection.min_distance_m !== "" ? (
          <span className="dossier-dl-row">
            <dt>Closest approach</dt>
            <dd>{Number(selection.min_distance_m).toFixed(0)} m</dd>
          </span>
        ) : null}
        {metricRow("Closest AIS point", selection.event_lat != null && selection.event_lon != null ? `${Number(selection.event_lat).toFixed(5)}, ${Number(selection.event_lon).toFixed(5)}` : undefined)}
        {metricRow("Closest AIS time", selection.closest_approach_ts ? formatStsWhen(selection.closest_approach_ts) : undefined)}
        {metricRow("Transfer probability", transferProbability != null ? `${Math.round(transferProbability)} / 100` : undefined)}
        {metricRow("Proximity score", proximityScore != null ? `${Math.round(proximityScore)} / 100` : undefined)}
        {metricRow("Cargo confidence", cargoConfidence != null ? `${Math.round(cargoConfidence)} / 100` : undefined)}
        {metricRow("Context", selection.context_label?.replace(/_/g, " "))}
        {metricRow("Anchorage / port", maritimeContext)}
        {metricRow("Petroleum facility", terminalContext)}
        {reasons.length ? (
          <span className="dossier-dl-row">
            <dt>Review reasons</dt>
            <dd>{reasons.join(" · ")}</dd>
          </span>
        ) : null}
        {selection.product_hint ? (
          <span className="dossier-dl-row">
            <dt>Product (inferred)</dt>
            <dd>{selection.product_hint}</dd>
          </span>
        ) : (
          <span className="dossier-dl-row">
            <dt>Product</dt>
            <dd style={{ color: "var(--muted)" }}>Not verified — AIS does not report cargo grade</dd>
          </span>
        )}
      </dl>

      <p className="disclaimer" style={{ marginTop: 12 }}>
        {selection.disclaimer ||
          "STS points are AIS proximity inferences. They indicate two vessels were close together for a period — not a confirmed cargo transfer, product grade, or title change."}
      </p>
    </div>
  );
}
