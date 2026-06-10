"use client";

import { useEffect, useState } from "react";
import {
  fetchMCRStatus,
  fetchSTSEvents,
  fetchUnknownSupplierLeads,
  type MCRScaffoldStatus,
  type UnknownSupplierLead,
} from "@/lib/energyApi";

type Props = {
  onOpenLive?: () => void;
};

type StsSignal = {
  label: string;
  meta: string;
  when?: string;
};

function formatWhen(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stsSignalFromProps(props: Record<string, unknown>): StsSignal {
  const a = props.vessel_a_name ?? props.vessel_a ?? props.vessel_name;
  const b = props.vessel_b_name ?? props.vessel_b;
  const score = props.score != null ? Number(props.score) : undefined;
  const label =
    a && b ? `${String(a)} ↔ ${String(b)}` : a ? String(a) : "STS proximity event";
  const metaParts: string[] = ["STS"];
  if (score != null && !Number.isNaN(score)) metaParts.push(`score ${score.toFixed(1)}`);
  if (props.zone_name) metaParts.push(String(props.zone_name));
  return {
    label,
    meta: metaParts.join(" · "),
    when: formatWhen(
      (props.occurred_at ?? props.started_at ?? props.detected_at) as string | undefined,
    ),
  };
}

export default function IntelHomeSummary({ onOpenLive }: Props) {
  const [leads, setLeads] = useState<UnknownSupplierLead[]>([]);
  const [mcr, setMcr] = useState<MCRScaffoldStatus | null>(null);
  const [stsCount, setStsCount] = useState<number | null>(null);
  const [signals, setSignals] = useState<StsSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchUnknownSupplierLeads(5).then(setLeads),
      fetchMCRStatus().then(setMcr),
      fetchSTSEvents()
        .then((fc) => {
          const feats = fc.features ?? [];
          setStsCount(feats.length);
          setSignals(
            feats
              .slice(0, 5)
              .map((f) => stsSignalFromProps((f.properties ?? {}) as Record<string, unknown>)),
          );
        })
        .catch(() => setStsCount(null)),
    ]).finally(() => setLoading(false));
  }, []);

  const topLead = leads[0];
  const showLeads = !loading && leads.length > 0;
  const showSts = !loading && stsCount != null && stsCount > 0;
  const showMcrLive = !loading && mcr != null && mcr.status !== "not_implemented";
  const nothingYet = !loading && !showLeads && !showSts && signals.length === 0;

  return (
    <div className="intel-home-summary">
      <p className="intel-home-hint">
        Click a map feature for evidence-backed dossiers. Toggle layers on the map to explore
        infrastructure and AIS.
      </p>

      {loading && (
        <div className="intel-home-grid">
          <div className="intel-home-stat intel-home-stat-wide">
            <span className="intel-home-stat-label">Live intel</span>
            <strong className="intel-home-stat-value">…</strong>
          </div>
        </div>
      )}

      {!loading && (showLeads || showSts || showMcrLive) && (
        <div className="intel-home-grid">
          {showLeads && (
            <div className="intel-home-stat">
              <span className="intel-home-stat-label">Corridor gaps</span>
              <strong className="intel-home-stat-value">{leads.length}</strong>
              {topLead && (
                <span className="intel-home-stat-meta">
                  {(topLead.corridor_label ??
                    [topLead.country_code, topLead.commodity].filter(Boolean).join(" · ")) ||
                    "ranked"}
                </span>
              )}
            </div>
          )}
          {showSts && (
            <div className="intel-home-stat">
              <span className="intel-home-stat-label">STS events</span>
              <strong className="intel-home-stat-value">
                {stsCount! >= 1000 ? `${(stsCount! / 1000).toFixed(1)}k` : stsCount}
              </strong>
              <span className="intel-home-stat-meta">global · toggle STS layer for viewport</span>
            </div>
          )}
          {showMcrLive && (
            <div className="intel-home-stat intel-home-stat-wide">
              <span className="intel-home-stat-label">MCR engine</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                <span className="badge partial compact">{mcr!.tier}</span>
                <span className="badge tier-none compact">{mcr!.status}</span>
              </div>
              <span className="intel-home-stat-meta">{mcr!.message}</span>
            </div>
          )}
        </div>
      )}

      {signals.length > 0 && (
        <>
          <div className="intel-home-section-label">Latest STS signals</div>
          <ul className="signal-timeline">
            {signals.map((s, i) => (
              <li key={i}>
                {s.when && <span className="signal-timeline-time">{s.when}</span>}
                <span className="signal-timeline-label">{s.label}</span>
                <span className="signal-timeline-meta">{s.meta}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {nothingYet && (
        <p className="intel-home-empty">
          Signal engines are warming up — STS, MCR and corridor intel appear here as workers
          ingest data. Explore the map layers meanwhile.
        </p>
      )}

      {onOpenLive && (
        <button type="button" className="panel-btn muted" style={{ marginTop: 10 }} onClick={onOpenLive}>
          Open full live intel feed →
        </button>
      )}

      <p className="disclaimer" style={{ marginTop: 12 }}>
        Inferred tiers — verify before outreach. Gulf/Hormuz AIS coverage is limited by provider.
      </p>
    </div>
  );
}
