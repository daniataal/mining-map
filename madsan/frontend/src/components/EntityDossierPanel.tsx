"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  AssetOperatorCapacitySection,
  VesselOwnershipSection,
  VesselSpecificationsSection,
} from "@/components/DossierEnrichmentSections";
import FeedbackFlywheel from "@/components/FeedbackFlywheel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { type HistoricPreset, useHistoricAggregates, useHistoricRange } from "@/lib/historicRange";

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

function confidenceBadgeVariant(score?: number | string, status?: string): "verified" | "partial" | "destructive" | "muted" {
  const cls = confidenceTierClass(score, status);
  if (cls === "tier-high") return "verified";
  if (cls === "tier-mid") return "partial";
  if (cls === "tier-low") return "destructive";
  return "muted";
}

function DossierSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function HistoricAggregateStub({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const { range, setPreset } = useHistoricRange("30d");
  const { data, loading, error } = useHistoricAggregates({
    entityType,
    entityId,
    range,
    enabled: !!entityId,
  });
  const presets: HistoricPreset[] = ["7d", "30d", "90d", "1y"];

  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <CardTitle className="text-sm">Signal history (aggregates)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="historic-range-bar">
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
        {loading && <Skeleton className="h-12 w-full" />}
        {!loading && error && (
          <p className="disclaimer" style={{ margin: 0 }}>Aggregates unavailable — {error.slice(0, 80)}</p>
        )}
        {!loading && !error && data && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--muted)" }}>
            {data.buckets.length
              ? `${data.buckets.length} ${data.bucket} buckets · ${data.metric}`
              : data.disclaimer ?? "No pre-aggregated buckets in range (stub API)."}
            {data.tier === "stub" ? " · server-side rollups pending migration" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

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
        <p>Energy layers: tank farms, terminals, refineries, vessels, pipelines.</p>
        <p className="disclaimer">Provider coverage varies by region. Missing data is shown honestly.</p>
      </>
    );
  }

  if (loading) return <DossierSkeleton />;
  if (error) return <p style={{ color: "#f87171" }}>{error}</p>;
  if (!dossier) return null;

  const score = dossier.confidence?.score;
  const summary = dossier.summary ?? {};
  const enrichment =
    dossier.entity_type === "vessel"
      ? resolveVesselEnrichment(dossier)
      : dossier.entity_type === "asset"
        ? resolveAssetEnrichment(dossier)
        : null;
  const loc = dossier.location ?? {};
  const lat = loc.latitude != null ? Number(loc.latitude) : NaN;
  const lng = loc.longitude != null ? Number(loc.longitude) : NaN;
  const showAisCoverageBadge =
    dossier.entity_type === "vessel" &&
    (Number.isFinite(lat) && Number.isFinite(lng) ? isPointInPersianGulf(lat, lng) : true);

  return (
    <div style={{ fontSize: 13 }}>
      <Card size="sm" className="mb-3">
        <CardHeader>
          <CardTitle>{dossier.name}</CardTitle>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <Badge variant={confidenceBadgeVariant(score, dossier.confidence?.status)}>
              {dossier.entity_type} · {score ?? "—"}
            </Badge>
            {showAisCoverageBadge && (
              <Badge variant="warn" title={LIMITED_AIS_COVERAGE_DETAIL}>
                {LIMITED_AIS_COVERAGE_LABEL}
              </Badge>
            )}
            {dossier.opportunity_score != null && (
              <Badge variant={confidenceBadgeVariant(dossier.opportunity_score)}>
                opp {Math.round(dossier.opportunity_score)}
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      {dossier.id && UUID_RE.test(dossier.id) && (
        <HistoricAggregateStub entityType={dossier.entity_type} entityId={dossier.id} />
      )}

      {dossier.signals && dossier.signals.length > 0 && (
        <Card size="sm" className="mb-3">
          <CardHeader>
            <CardTitle className="text-sm">Live signals</CardTitle>
          </CardHeader>
          <CardContent>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {dossier.signals.map((s) => (
                <li key={`${s.signal_type}-${s.label}`}>
                  {s.label}
                  <span style={{ color: "var(--muted)" }}> ({s.tier}{s.detail ? ` — ${s.detail}` : ""})</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <VesselOwnershipSection dossier={dossier} />
      <VesselSpecificationsSection dossier={dossier} />
      <AssetOperatorCapacitySection dossier={dossier} />

      {dossier.signal_history && dossier.signal_history.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Signal history</strong>
          <ul className="signal-timeline">
            {dossier.signal_history.map((h) => (
              <li key={`${h.signal_type}-${h.observed_at}`}>
                <span className="signal-timeline-time">{formatObservedAt(h.observed_at)}</span>
                <span className="signal-timeline-label">{h.label}</span>
                <span className="signal-timeline-meta">
                  {h.tier}
                  {h.signal_type === "sts" ? ` · score ${Math.round(h.confidence_score)}` : ""}
                  {h.opportunity_score != null ? ` · opp ${Math.round(h.opportunity_score)}` : ""}
                  {h.source ? ` · ${h.source}` : ""}
                  {h.detail ? ` · ${h.detail}` : ""}
                </span>
                {h.signal_type === "sts" && h.sts_factors && h.sts_factors.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "var(--muted)" }}>
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
        </div>
      )}

      <dl style={{ margin: "0 0 12px", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", color: "var(--muted)" }}>
        {Object.entries(summary).map(([k, v]) => {
          const display = formatSummaryValue(v);
          if (display == null || summaryKeyHiddenInEnrichment(k, enrichment, dossier.entity_type)) return null;
          return (
            <span key={k} style={{ display: "contents" }}>
              <dt>{k.replace(/_/g, " ")}</dt>
              <dd style={{ margin: 0, color: "var(--text)" }}>{display}</dd>
            </span>
          );
        })}
        {loc.latitude != null && (
          <>
            <dt>coordinates</dt>
            <dd style={{ margin: 0, color: "var(--text)" }}>{String(loc.latitude)}, {String(loc.longitude)}</dd>
          </>
        )}
      </dl>

      {dossier.relationships && dossier.relationships.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Relationships</strong>
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
        </div>
      )}

      {dossier.evidence && dossier.evidence.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <strong>Evidence chain</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
            {dossier.evidence.slice(0, 10).map((e) => (
              <li key={`${e.claim_type}-${e.source_name}`}>
                <span style={{ color: "var(--text)" }}>{e.claim_type}</span>
                {e.claim_value && (
                  <span style={{ color: "var(--muted)" }}>: {e.claim_value.length > 48 ? `${e.claim_value.slice(0, 48)}…` : e.claim_value}</span>
                )}
                <span style={{ color: "var(--muted)" }}> — {e.source_name}{e.tier ? ` (${e.tier})` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dossier.entity_type === "company" && (
        <Link
          href={`/deals?seller=${encodeURIComponent(dossier.name)}${vertical === "metals" ? "&vertical=metals" : ""}`}
          style={{ fontSize: 12 }}
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
