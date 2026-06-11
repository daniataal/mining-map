"use client";

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

export default function STSEventPanel({ selection, onNavigate }: Props) {
  const score = Number(selection.confidence_score);
  const title = selection.name || selection.event_title || "STS event";
  const kind = stsEventKindLabel(selection.event_kind);
  const when = formatStsWhen(selection.start_ts, selection.end_ts, selection.observed_at);

  return (
    <div className="dossier-tabbed">
      <div className="dossier-head">
        <h3 className="dossier-title">{title}</h3>
        <div className="dossier-head-badges">
          <span className="badge compact">{kind}</span>
          {!Number.isNaN(score) && score > 0 && (
            <span className={`badge compact ${confidenceTierClass(score, selection.tier)}`}>
              score {Math.round(score)}
            </span>
          )}
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
