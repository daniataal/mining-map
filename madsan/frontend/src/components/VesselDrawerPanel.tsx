"use client";

import { useEffect, useState } from "react";
import {
  AssetOperatorCapacitySection,
  VesselOwnershipSection,
  VesselSpecificationsSection,
} from "@/components/DossierEnrichmentSections";
import StartDealPackLink from "@/components/StartDealPackLink";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { confidenceTierClass } from "@/lib/confidenceTier";
import {
  type CoreDossier,
  formatSummaryValue,
  resolveVesselEnrichment,
  summaryKeyHiddenInEnrichment,
} from "@/lib/dossier";
import {
  fetchShipvaultCompany,
  fetchVesselPortCalls,
  type PortCallRecord,
  type ShipvaultFleetVessel,
} from "@/lib/energyApi";
import { LIMITED_AIS_COVERAGE_DETAIL, LIMITED_AIS_COVERAGE_LABEL, isPointInPersianGulf } from "@/lib/layers";

type STSScoreFactor = {
  name: string;
  weighted: number;
  detail: string;
};

type SignalHistoryEntry = {
  signal_type: string;
  label: string;
  tier: string;
  confidence_score: number;
  opportunity_score?: number;
  observed_at: string;
  source?: string;
  detail?: string;
  sts_factors?: STSScoreFactor[];
};

type Dossier = CoreDossier & {
  evidence?: Array<{ source_name: string; claim_type: string; claim_value?: string; tier?: string }>;
  signals?: Array<{ signal_type: string; label: string; tier: string; detail?: string }>;
  signal_history?: SignalHistoryEntry[];
};

type Props = {
  dossier: Dossier;
  onNavigateMmsi?: (mmsi: string, name?: string) => void;
};

function formatTs(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function readOwnerCompanyId(summary: Record<string, unknown>): string | undefined {
  const op = summary.owner_profile;
  if (!op || typeof op !== "object" || Array.isArray(op)) return undefined;
  const id = (op as Record<string, unknown>).shipvault_company_id;
  return id != null ? String(id) : undefined;
}

function PortCallCard({ pc }: { pc: PortCallRecord }) {
  return (
    <div className="intel-card">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className={`badge compact ${pc.tier === "observed" ? "verified" : "partial"}`}>{pc.tier}</span>
        <strong style={{ fontSize: 12 }}>{pc.terminal_name ?? "Terminal"}</strong>
        {pc.status && <span style={{ fontSize: 10, color: "var(--muted)" }}>{pc.status}</span>}
      </div>
      <p style={{ margin: "4px 0", fontSize: 11, color: "var(--muted)" }}>
        {[pc.country, pc.commodity_family, pc.event_type?.replace(/_/g, " ")].filter(Boolean).join(" · ")}
      </p>
      <p style={{ margin: 0, fontSize: 11 }}>
        {formatTs(pc.arrival_ts)}
        {pc.departure_ts ? ` → ${formatTs(pc.departure_ts)}` : ""}
        {pc.confidence_score != null ? ` · ${Math.round(pc.confidence_score)}%` : ""}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--muted)" }}>Source: {pc.source}</p>
    </div>
  );
}

function FleetTable({
  fleet,
  onSelectMmsi,
}: {
  fleet: ShipvaultFleetVessel[];
  onSelectMmsi?: (mmsi: string, name?: string) => void;
}) {
  if (!fleet.length) {
    return (
      <p className="disclaimer" style={{ marginTop: 8, paddingTop: 0, borderTop: 0 }}>
        Fleet list empty — run vessel-enrich with ShipVault credentials.
      </p>
    );
  }
  return (
    <div className="fleet-table-wrap">
      <table className="fleet-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>IMO</th>
            <th>DWT</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {fleet.slice(0, 50).map((v, i) => {
            const mmsi = v.mmsi ? String(v.mmsi) : "";
            return (
              <tr key={`${v.imo ?? v.name ?? i}`}>
                <td>
                  {mmsi && onSelectMmsi ? (
                    <button type="button" className="fleet-link" onClick={() => onSelectMmsi(mmsi, v.name)}>
                      {v.name ?? "—"}
                    </button>
                  ) : (
                    v.name ?? "—"
                  )}
                </td>
                <td>{v.imo ?? "—"}</td>
                <td>{v.dwt != null ? v.dwt.toLocaleString() : "—"}</td>
                <td>{v.type ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {fleet.length > 50 && (
        <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>Showing 50 of {fleet.length} vessels.</p>
      )}
    </div>
  );
}

export default function VesselDrawerPanel({ dossier, onNavigateMmsi }: Props) {
  const [tab, setTab] = useState("identity");
  const [portCalls, setPortCalls] = useState<PortCallRecord[]>([]);
  const [portCallsLoading, setPortCallsLoading] = useState(false);
  const [fleet, setFleet] = useState<ShipvaultFleetVessel[]>([]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetMeta, setFleetMeta] = useState<{ name?: string; fleet_size?: number; total_dwt?: number }>({});

  const summary = dossier.summary ?? {};
  const mmsi = summary.mmsi != null ? String(summary.mmsi) : "";
  const score = dossier.confidence?.score;
  const enrichment = resolveVesselEnrichment(dossier);
  const loc = dossier.location ?? {};
  const lat = loc.latitude != null ? Number(loc.latitude) : NaN;
  const lng = loc.longitude != null ? Number(loc.longitude) : NaN;
  const showAisCoverageBadge =
    Number.isFinite(lat) && Number.isFinite(lng) ? isPointInPersianGulf(lat, lng) : true;

  const stsHistory = (dossier.signal_history ?? []).filter((h) => h.signal_type === "sts");
  const mcrHistory = (dossier.signal_history ?? []).filter(
    (h) => h.signal_type === "mcr" || h.signal_type === "cargo" || h.label.toLowerCase().includes("cargo"),
  );

  useEffect(() => {
    setTab("identity");
  }, [mmsi]);

  useEffect(() => {
    if (tab !== "port-calls" || !mmsi) return;
    setPortCallsLoading(true);
    fetchVesselPortCalls(mmsi)
      .then(setPortCalls)
      .finally(() => setPortCallsLoading(false));
  }, [tab, mmsi]);

  useEffect(() => {
    if (tab !== "registry") return;
    const companyId = readOwnerCompanyId(summary);
    if (!companyId) {
      setFleet([]);
      return;
    }
    setFleetLoading(true);
    fetchShipvaultCompany(companyId)
      .then((co) => {
        if (!co) {
          setFleet([]);
          return;
        }
        setFleetMeta({ name: co.name, fleet_size: co.fleet_size, total_dwt: co.total_dwt });
        setFleet(Array.isArray(co.fleet_list) ? co.fleet_list : []);
      })
      .finally(() => setFleetLoading(false));
  }, [tab, summary]);

  return (
    <div className="vessel-drawer vessel-drawer-selected">
      <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className={`badge compact ${confidenceTierClass(score, dossier.confidence?.status)}`}>
          vessel · {score ?? "—"}
        </span>
        {showAisCoverageBadge && (
          <span className="badge warn compact" title={LIMITED_AIS_COVERAGE_DETAIL}>
            {LIMITED_AIS_COVERAGE_LABEL}
          </span>
        )}
        {dossier.opportunity_score != null && (
          <span className={`badge compact ${confidenceTierClass(dossier.opportunity_score)}`}>
            opp {Math.round(dossier.opportunity_score)}
          </span>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="port-calls">Port calls</TabsTrigger>
          <TabsTrigger value="mcr">MCR</TabsTrigger>
          <TabsTrigger value="sts">STS</TabsTrigger>
        </TabsList>

        <TabsContent value="identity">
          <dl className="dossier-dl">
            {Object.entries(summary).map(([k, v]) => {
              const display = formatSummaryValue(v);
              if (display == null || summaryKeyHiddenInEnrichment(k, enrichment, "vessel")) return null;
              return (
                <span key={k} className="dossier-dl-row">
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd>{display}</dd>
                </span>
              );
            })}
            {loc.latitude != null && (
              <span className="dossier-dl-row">
                <dt>coordinates</dt>
                <dd>
                  {String(loc.latitude)}, {String(loc.longitude)}
                </dd>
              </span>
            )}
          </dl>
          {dossier.signals && dossier.signals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>Live signals</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11 }}>
                {dossier.signals.map((s) => (
                  <li key={`${s.signal_type}-${s.label}`}>
                    {s.label}
                    <span style={{ color: "var(--muted)" }}>
                      {" "}
                      ({s.tier}
                      {s.detail ? ` — ${s.detail}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="registry">
          <VesselOwnershipSection dossier={dossier} />
          <VesselSpecificationsSection dossier={dossier} />
          {fleetMeta.name && (
            <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0" }}>
              {fleetMeta.name}
              {fleetMeta.fleet_size != null ? ` · ${fleetMeta.fleet_size} vessels` : ""}
              {fleetMeta.total_dwt != null ? ` · ${Math.round(fleetMeta.total_dwt).toLocaleString()} DWT total` : ""}
            </p>
          )}
          {fleetLoading ? (
            <p style={{ fontSize: 11, color: "var(--muted)" }}>Loading ShipVault fleet…</p>
          ) : (
            <FleetTable fleet={fleet} onSelectMmsi={onNavigateMmsi} />
          )}
        </TabsContent>

        <TabsContent value="port-calls">
          {portCallsLoading && <p style={{ fontSize: 11, color: "var(--muted)" }}>Loading port calls…</p>}
          {!portCallsLoading && portCalls.length === 0 && (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No port calls on file — appears after legacy migration (Phase A) or live geofence detection (Phase E).
            </p>
          )}
          <div className="intel-card-stack">
            {portCalls.map((pc, i) => (
              <PortCallCard key={`${pc.arrival_ts}-${pc.terminal_name}-${i}`} pc={pc} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="mcr">
          {mcrHistory.length === 0 ? (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No MCR cargo signals for this vessel. Synthetic BOL engine (recipes A–G) runs in Phase B worker.
            </p>
          ) : (
            <ul className="signal-timeline">
              {mcrHistory.map((h) => (
                <li key={`${h.signal_type}-${h.observed_at}`}>
                  <span className="signal-timeline-time">{formatTs(h.observed_at)}</span>
                  <span className="signal-timeline-label">{h.label}</span>
                  <span className="signal-timeline-meta">
                    {h.tier} · score {Math.round(h.confidence_score)}
                    {h.detail ? ` · ${h.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sts">
          {stsHistory.length === 0 ? (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No STS proximity events in signal history. Map STS layer fills after oil_sts_events migration.
            </p>
          ) : (
            <ul className="signal-timeline">
              {stsHistory.map((h) => (
                <li key={`${h.signal_type}-${h.observed_at}`}>
                  <span className="signal-timeline-time">{formatTs(h.observed_at)}</span>
                  <span className="signal-timeline-label">{h.label}</span>
                  <span className="signal-timeline-meta">
                    {h.tier} · score {Math.round(h.confidence_score)}
                    {h.source ? ` · ${h.source}` : ""}
                  </span>
                  {h.sts_factors && h.sts_factors.length > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 10, color: "var(--muted)" }}>
                      {h.sts_factors.map((f) => (
                        <li key={`${h.observed_at}-${f.name}`}>
                          {f.name.replace(/_/g, " ")} {(f.weighted * 100).toFixed(0)}% — {f.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <StartDealPackLink dossier={dossier} vertical="energy" />
    </div>
  );
}
