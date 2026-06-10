"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  AssetOperatorCapacitySection,
  VesselOwnershipSection,
  VesselSpecificationsSection,
} from "@/components/DossierEnrichmentSections";
import HistoricChart from "@/components/HistoricChart";
import VesselDrawerPanel from "@/components/VesselDrawerPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeedbackFlywheel from "@/components/FeedbackFlywheel";
import { authFetchOpts } from "@/lib/auth";
import { confidenceTierClass } from "@/lib/confidenceTier";
import {
  type CoreDossier,
  resolveAssetEnrichment,
  resolveVesselEnrichment,
  formatSummaryValue,
  summaryKeyHiddenInEnrichment,
} from "@/lib/dossier";
import {
  isPointInPersianGulf,
  LIMITED_AIS_COVERAGE_DETAIL,
  LIMITED_AIS_COVERAGE_LABEL,
  API_BASE,
} from "@/lib/layers";

export type MapSelection = {
  id?: string;
  legacy_row_id?: string;
  name?: string;
  mmsi?: string;
  _entityType?: string;
  _layer?: string;
  asset_type?: string;
  country_code?: string;
  confidence_score?: number | string;
  operator?: string;
  substance?: string;
  pipeline_substance?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EvidenceClaim = {
  source_name: string;
  claim_type: string;
  claim_value?: string;
  tier?: string;
  confidence_score?: number;
};

type EntitySignal = {
  signal_type: string;
  label: string;
  score?: number;
  tier: string;
  detail?: string;
};

type STSScoreFactor = {
  name: string;
  weight: number;
  score: number;
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
  evidence?: EvidenceClaim[];
  signals?: EntitySignal[];
  signal_history?: SignalHistoryEntry[];
  relationships?: RelationshipEdge[];
};

function formatObservedAt(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type RelationshipEdge = {
  id: string;
  type: string;
  entity_type: string;
  name: string;
  direction?: string;
  confidence_score?: number;
  latitude?: number;
  longitude?: number;
};

type Props = {
  selection: MapSelection | null;
  vertical?: "energy" | "metals";
  onNavigate?: (selection: MapSelection, focus?: { lat: number; lng: number }) => void;
  onRelationshipLines?: (lines: FeatureCollection) => void;
};

function buildRelationshipLines(dossier: Dossier | null): FeatureCollection {
  if (!dossier?.location) {
    return { type: "FeatureCollection", features: [] };
  }
  const lat = Number(dossier.location.latitude);
  const lng = Number(dossier.location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { type: "FeatureCollection", features: [] };
  }
  const features = (dossier.relationships ?? [])
    .filter((r) => r.latitude != null && r.longitude != null)
    .map((r) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [lng, lat],
          [r.longitude!, r.latitude!],
        ],
      },
      properties: { rel: r.type, name: r.name },
    }));
  return { type: "FeatureCollection", features };
}

export default function EntityDossierPanel({ selection, vertical = "energy", onNavigate, onRelationshipLines }: Props) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    setTab("overview");
  }, [selection?.id, selection?.mmsi]);

  useEffect(() => {
    if (!selection) {
      setDossier(null);
      return;
    }
    const entityType = selection._entityType ?? "asset";
    const id = selection.id;
    const mmsi = selection.mmsi;

    let url = "";
    const isPipeline = selection._layer === "pipelines";
    const legacyId = selection.legacy_row_id ?? (id && !UUID_RE.test(id) ? id : undefined);
    if (id && UUID_RE.test(id)) {
      url = `${API_BASE}/api/core/entities/${entityType}/${id}`;
    } else if (isPipeline && legacyId) {
      url = `${API_BASE}/api/core/assets/lookup?legacy_table=legacy_petroleum_osm_features&legacy_id=${encodeURIComponent(legacyId)}`;
    } else if (mmsi && entityType === "vessel") {
      url = `${API_BASE}/api/energy/vessels/by-mmsi/${mmsi}`;
    } else {
      setDossier({
        id: "",
        entity_type: entityType,
        name: String(selection.name ?? (isPipeline ? "Pipeline" : "Unknown")),
        summary: {
          asset_type: selection.asset_type ?? (isPipeline ? "pipeline" : undefined),
          country_code: selection.country_code,
          operator: selection.operator,
          substance: selection.substance || selection.pipeline_substance,
        },
        confidence: { score: Number(selection.confidence_score) || undefined },
        evidence: isPipeline
          ? [{ source_name: "OpenStreetMap petroleum", claim_type: "geometry", tier: "observed" }]
          : [],
        limitations: [
          isPipeline
            ? "Pipeline geometry from OSM; full asset dossier available after legacy import links this feature."
            : "No registry ID — live AIS overlay only",
        ],
      });
      return;
    }

    setLoading(true);
    setError("");
    fetch(url, authFetchOpts)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<Dossier>;
      })
      .then(setDossier)
      .catch((e) => {
        setDossier(null);
        setError(e instanceof Error ? e.message : "Failed to load dossier");
      })
      .finally(() => setLoading(false));
  }, [selection]);

  useEffect(() => {
    onRelationshipLines?.(buildRelationshipLines(dossier));
  }, [dossier, onRelationshipLines]);

  if (!selection) {
    if (vertical === "metals") {
      return (
        <>
          <p>Click a mine, license polygon, or smelter to inspect cadastre-backed intelligence.</p>
          <p>Layers: mining licenses (partial global coverage), smelters &amp; processing plants.</p>
          <p className="disclaimer">
            License cadastre is incomplete — missing jurisdictions are not shown as empty confirmation.
            Petroleum OSM assets appear on the energy vertical only.
          </p>
        </>
      );
    }
    return (
      <>
        <p>Click a map feature to inspect evidence-backed intelligence.</p>
        <p>Energy: granular infrastructure toggles, STS/MCR overlays, vessel track on focus.</p>
        <p className="disclaimer">Provider coverage varies by region. Missing data is shown honestly.</p>
      </>
    );
  }

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading dossier…</p>;
  if (error) return <p style={{ color: "#f87171" }}>{error}</p>;
  if (!dossier) return null;

  if (dossier.entity_type === "vessel") {
    return (
      <VesselDrawerPanel
        dossier={dossier}
        onNavigateMmsi={(mmsi, name) =>
          onNavigate?.({ mmsi, name, _entityType: "vessel", _layer: "vessels" })
        }
      />
    );
  }

  const score = dossier.confidence?.score;
  const summary = dossier.summary ?? {};
  const enrichment =
    dossier.entity_type === "asset" ? resolveAssetEnrichment(dossier) : null;
  const entityId = dossier.id || selection.id || "";

  return (
    <div className="dossier-tabbed">
      <h3 style={{ margin: "0 0 0.5rem" }}>{dossier.name}</h3>
      <div style={{ marginBottom: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className={`badge compact ${confidenceTierClass(score, dossier.confidence?.status)}`}>
          {dossier.entity_type} · {score ?? "—"}
        </span>
        {dossier.opportunity_score != null && (
          <span className={`badge compact ${confidenceTierClass(dossier.opportunity_score)}`}>
            opp {Math.round(dossier.opportunity_score)}
          </span>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="trade">Trade</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <VesselOwnershipSection dossier={dossier} />
          <VesselSpecificationsSection dossier={dossier} />
          <AssetOperatorCapacitySection dossier={dossier} />
          <dl className="dossier-dl">
            {Object.entries(summary).map(([k, v]) => {
              const display = formatSummaryValue(v);
              if (display == null || summaryKeyHiddenInEnrichment(k, enrichment, dossier.entity_type)) return null;
              return (
                <span key={k} className="dossier-dl-row">
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd>{display}</dd>
                </span>
              );
            })}
          </dl>
        </TabsContent>

        <TabsContent value="signals">
          {dossier.signals && dossier.signals.length > 0 ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
              {dossier.signals.map((s) => (
                <li key={`${s.signal_type}-${s.label}`}>
                  {s.label}
                  <span style={{ color: "var(--muted)" }}> ({s.tier}{s.detail ? ` — ${s.detail}` : ""})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No live signals on this entity.
            </p>
          )}
          {dossier.signal_history && dossier.signal_history.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Signal history</strong>
              <ul className="signal-timeline">
                {dossier.signal_history.map((h) => (
                  <li key={`${h.signal_type}-${h.observed_at}`}>
                    <span className="signal-timeline-time">{formatObservedAt(h.observed_at)}</span>
                    <span className="signal-timeline-label">{h.label}</span>
                    <span className="signal-timeline-meta">
                      {h.tier}
                      {h.detail ? ` · ${h.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>

        <TabsContent value="relationships">
          {dossier.relationships && dossier.relationships.length > 0 ? (
            <ul className="rel-list">
              {dossier.relationships.map((rel) => (
                <li key={`${rel.type}-${rel.id}`}>
                  <button
                    type="button"
                    className="rel-link"
                    onClick={() => {
                      const focus =
                        rel.latitude != null && rel.longitude != null
                          ? { lat: rel.latitude, lng: rel.longitude }
                          : undefined;
                      onNavigate?.(
                        { id: rel.id, name: rel.name, _entityType: rel.entity_type },
                        focus,
                      );
                    }}
                  >
                    <span className="rel-type">{rel.type.replace(/_/g, " ")}</span>
                    <span className="rel-name">{rel.name}</span>
                    <span className="rel-meta">{rel.entity_type}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No graph relationships indexed for this entity yet.
            </p>
          )}
        </TabsContent>

        <TabsContent value="evidence">
          {dossier.evidence && dossier.evidence.length > 0 ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
              {dossier.evidence.map((e) => (
                <li key={`${e.claim_type}-${e.source_name}`}>
                  <span style={{ color: "var(--text)" }}>{e.claim_type}</span>
                  {e.claim_value && (
                    <span style={{ color: "var(--muted)" }}>
                      : {e.claim_value.length > 48 ? `${e.claim_value.slice(0, 48)}…` : e.claim_value}
                    </span>
                  )}
                  <span style={{ color: "var(--muted)" }}> — {e.source_name}{e.tier ? ` (${e.tier})` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              Evidence chain empty — ingestion or enrichment pending.
            </p>
          )}
        </TabsContent>

        <TabsContent value="trade">
          {entityId && UUID_RE.test(entityId) && (
            <HistoricChart
              entityType={dossier.entity_type}
              entityId={entityId}
              metric="signals"
              title="Activity (server aggregates)"
            />
          )}
          {entityId && UUID_RE.test(entityId) && (
            <div style={{ marginTop: 16 }}>
              <HistoricChart
                entityType={dossier.entity_type}
                entityId={entityId}
                metric="price_context"
                title="Price context (historic rollup)"
                valueLabel="index"
              />
            </div>
          )}
          <p className="disclaimer" style={{ marginTop: 12 }}>
            Trade-flow charts use pre-bucketed aggregates only — no raw manifest rows in the browser.
          </p>
        </TabsContent>
      </Tabs>

      {dossier.entity_type === "company" && (
        <Link
          href={`/deals?seller=${encodeURIComponent(dossier.name)}${vertical === "metals" ? "&vertical=metals" : ""}`}
          style={{ fontSize: 12, display: "inline-block", marginTop: 12 }}
        >
          Verify deal with this seller →
        </Link>
      )}

      {dossier.limitations && dossier.limitations.length > 0 && (
        <p className="disclaimer" style={{ marginTop: 12 }}>
          {dossier.limitations[0]}
        </p>
      )}

      <FeedbackFlywheel
        mode="data"
        entityType={dossier.entity_type}
        entityId={dossier.id || undefined}
        entityName={dossier.name}
      />
    </div>
  );
}
