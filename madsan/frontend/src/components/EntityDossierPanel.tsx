"use client";

import { useEffect, useState } from "react";
import StartDealPackLink from "@/components/StartDealPackLink";
import type { FeatureCollection } from "geojson";
import {
  AssetOperatorCapacitySection,
  GemPipelineProfileSection,
  VesselOwnershipSection,
  VesselSpecificationsSection,
} from "@/components/DossierEnrichmentSections";
import HistoricChart from "@/components/HistoricChart";
import IntelHomeSummary from "@/components/IntelHomeSummary";
import STSEventPanel from "@/components/STSEventPanel";
import StorageSitePanel from "@/components/StorageSitePanel";
import VesselDrawerPanel from "@/components/VesselDrawerPanel";
import { isStsSelection } from "@/lib/stsDisplay";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeedbackFlywheel from "@/components/FeedbackFlywheel";
import { fetchNearestGemPipeline, fetchPipelineConnectivity, buildPipelineMapFocus, type PipelineMapFocus } from "@/lib/energyApi";
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
  signal_id?: string;
  legacy_row_id?: string;
  name?: string;
  event_title?: string;
  mmsi?: string;
  mmsi_a?: string;
  mmsi_b?: string;
  vessel_a_name?: string;
  vessel_b_name?: string;
  vessel_a_class?: string;
  vessel_b_class?: string;
  event_kind?: string;
  product_hint?: string;
  zone_name?: string;
  min_distance_m?: number | string;
  transfer_probability?: number | string;
  proximity_score?: number | string;
  cargo_confidence?: number | string;
  future_pair_probability?: number | string;
  horizon_hours?: number | string;
  prediction_kind?: string;
  pair_key?: string;
  context_label?: string;
  review_tier?: string;
  downgrade_reasons?: unknown;
  maritime_context?: unknown;
  nearest_oil_terminal?: unknown;
  distance_m?: number | string;
  latest_a?: string;
  latest_b?: string;
  event_lat?: number | string;
  event_lon?: number | string;
  closest_approach_ts?: string;
  start_ts?: string;
  end_ts?: string;
  predicted_at?: string;
  expires_at?: string;
  observed_at?: string;
  disclaimer?: string;
  tier?: string;
  _entityType?: string;
  _layer?: string;
  asset_type?: string;
  country_code?: string;
  confidence_score?: number | string;
  operator?: string;
  substance?: string;
  pipeline_substance?: string;
  pipeline_status?: string;
  pipeline_source?: string;
  osm_id?: string;
  click_lat?: number;
  click_lng?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gemSegmentKeyFromSelection(selection: MapSelection): string | undefined {
  if (selection.osm_id?.startsWith("gem:")) {
    return selection.osm_id.slice(4);
  }
  if (
    selection.pipeline_source === "gem" &&
    selection.legacy_row_id &&
    !UUID_RE.test(selection.legacy_row_id)
  ) {
    return selection.legacy_row_id;
  }
  return undefined;
}

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
  pipelineMapFocused?: boolean;
  onNavigate?: (selection: MapSelection, focus?: { lat: number; lng: number }) => void;
  onRelationshipLines?: (lines: FeatureCollection) => void;
  onPipelineFocus?: (focus: PipelineMapFocus) => void;
  onExitPipelineFocus?: () => void;
  onOpenLive?: () => void;
};

function gemLookupURL(segmentKey: string): string {
  return `${API_BASE}/api/core/assets/lookup?legacy_table=gem_goit_pipelines&legacy_id=${encodeURIComponent(segmentKey)}`;
}

function osmPipelineLookupURL(legacyId: string): string {
  return `${API_BASE}/api/core/assets/lookup?legacy_table=legacy_petroleum_osm_features&legacy_id=${encodeURIComponent(legacyId)}`;
}

async function loadDossierJSON(url: string): Promise<Dossier> {
  const r = await fetch(url, authFetchOpts);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<Dossier>;
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

function buildSelectionShell(selection: MapSelection): Dossier {
  const isPipeline = selection._layer === "pipelines";
  const entityType = selection._entityType ?? "asset";
  return {
    id: selection.id && UUID_RE.test(selection.id) ? selection.id : "",
    entity_type: entityType,
    name: String(selection.name ?? (isPipeline ? "Pipeline" : "Unknown")),
    summary: {
      asset_type: selection.asset_type ?? (isPipeline ? "pipeline" : undefined),
      country_code: selection.country_code,
      operator: selection.operator,
      substance: selection.substance || selection.pipeline_substance,
      status: selection.pipeline_status,
    },
    confidence: { score: Number(selection.confidence_score) || undefined },
    evidence: [],
    limitations: [],
  };
}

export default function EntityDossierPanel({
  selection,
  vertical = "energy",
  pipelineMapFocused,
  onNavigate,
  onRelationshipLines,
  onPipelineFocus,
  onExitPipelineFocus,
  onOpenLive,
}: Props) {
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
    if (isStsSelection(selection)) {
      setDossier(null);
      setError("");
      setLoading(false);
      return;
    }

    const entityType = selection._entityType ?? "asset";
    const mmsi = selection.mmsi;
    const isPipeline = selection._layer === "pipelines";
    const gemKey = gemSegmentKeyFromSelection(selection);
    const legacyId =
      selection.legacy_row_id ?? (selection.id && !UUID_RE.test(selection.id) ? selection.id : undefined);
    const isOsmPipeline = isPipeline && !gemKey && selection.pipeline_source !== "gem";
    const clickLat = selection.click_lat;
    const clickLng = selection.click_lng;

    let cancelled = false;

    async function resolvePipelineDossier(): Promise<Dossier | null> {
      if (clickLat == null || clickLng == null || !isOsmPipeline) return null;
      const near = await fetchNearestGemPipeline(clickLat, clickLng);
      if (!near.found || !near.segment_key) return null;
      const d = await loadDossierJSON(gemLookupURL(near.segment_key));
      if (near.distance_m != null) {
        d.limitations = [
          ...(d.limitations ?? []),
          `GEM GOIT segment matched ${near.distance_m}m from OSM map click (CC BY 4.0 — verify independently).`,
        ];
      }
      return d;
    }

    // Pipelines resolve to a Postgres/GEM dossier — skip the map-click shell so we
    // don't flash "Commercial (GEM) NOT AVAILABLE" before the registry API responds.
    const skipOptimisticShell =
      isPipeline &&
      (!!gemKey ||
        !!(selection!.id && UUID_RE.test(selection!.id)) ||
        !!(legacyId && !UUID_RE.test(legacyId)) ||
        (isOsmPipeline && clickLat != null && clickLng != null));

    async function load() {
      setError("");
      if (skipOptimisticShell) {
        setDossier(null);
      } else {
        setDossier(buildSelectionShell(selection!));
      }
      setLoading(true);
      try {
        if (gemKey) {
          const d = await loadDossierJSON(gemLookupURL(gemKey));
          if (!cancelled) setDossier(d);
          return;
        }

        if (selection!.id && UUID_RE.test(selection!.id)) {
          const d = await loadDossierJSON(`${API_BASE}/api/core/entities/${entityType}/${selection!.id}`);
          if (!cancelled) setDossier(d);
          return;
        }

        if (isOsmPipeline && clickLat != null && clickLng != null) {
          const fused = await resolvePipelineDossier();
          if (fused) {
            if (!cancelled) setDossier(fused);
            return;
          }
        }

        if (isPipeline && legacyId && !UUID_RE.test(legacyId)) {
          try {
            const d = await loadDossierJSON(osmPipelineLookupURL(legacyId));
            if (!cancelled) setDossier(d);
            return;
          } catch {
            const fused = await resolvePipelineDossier();
            if (fused) {
              if (!cancelled) setDossier(fused);
              return;
            }
            if (!cancelled) {
              setDossier(null);
              setError("No registry dossier — OSM geometry only (no GEM segment within 2 km).");
            }
            return;
          }
        }

        if (mmsi && entityType === "vessel") {
          const d = await loadDossierJSON(`${API_BASE}/api/energy/vessels/by-mmsi/${mmsi}`);
          if (!cancelled) setDossier(d);
          return;
        }

        if (!cancelled) {
          setDossier({
            id: "",
            entity_type: entityType,
            name: String(selection!.name ?? (isPipeline ? "Pipeline" : "Unknown")),
            summary: {
              asset_type: selection!.asset_type ?? (isPipeline ? "pipeline" : undefined),
              country_code: selection!.country_code,
              operator: selection!.operator,
              substance: selection!.substance || selection!.pipeline_substance,
            },
            confidence: { score: Number(selection!.confidence_score) || undefined },
            evidence: isPipeline
              ? [{ source_name: "OpenStreetMap petroleum", claim_type: "geometry", tier: "observed" }]
              : [],
            limitations: [
              isPipeline
                ? "Pipeline geometry from OSM; no GEM GOIT segment within 2 km and no registry link."
                : "No registry ID — live AIS overlay only",
            ],
          });
        }
      } catch (e) {
        if (!cancelled) {
          setDossier(null);
          setError(e instanceof Error ? e.message : "Failed to load dossier");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selection]);

  useEffect(() => {
    onRelationshipLines?.(buildRelationshipLines(dossier));
  }, [dossier, onRelationshipLines]);

  useEffect(() => {
    if (!onPipelineFocus) return;
    const assetType = String(dossier?.summary?.asset_type ?? selection?.asset_type ?? "");
    if (assetType !== "pipeline" && selection?._layer !== "pipelines") {
      onPipelineFocus(null);
      return;
    }
    const pipelineKey =
      (dossier?.id && UUID_RE.test(dossier.id) && dossier.id) ||
      selection?.osm_id ||
      gemSegmentKeyFromSelection(selection ?? {}) ||
      selection?.legacy_row_id;
    if (!pipelineKey) return;
    let cancelled = false;
    fetchPipelineConnectivity(pipelineKey)
      .then((conn) => {
        if (cancelled || !conn) return;
        onPipelineFocus(
          buildPipelineMapFocus(conn, {
            osm_id: selection?.osm_id,
            legacy_row_id: selection?.legacy_row_id ?? gemSegmentKeyFromSelection(selection ?? {}),
            id: dossier?.id && UUID_RE.test(dossier.id) ? dossier.id : selection?.id,
          }),
        );
      })
      .catch(() => {
        /* keep map-click focus when connectivity is slow or unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, [dossier, selection, onPipelineFocus]);

  if (!selection) {
    if (vertical === "metals") {
      return (
        <>
          <p>Click a mine, license polygon, or smelter to inspect cadastre-backed intelligence.</p>
          <p>Layers: mining licenses (partial global coverage), smelters &amp; processing plants.</p>
          <p className="disclaimer">
            License cadastre is incomplete — missing jurisdictions are not shown as empty confirmation.
            Petroleum rights (leases, permits) appear on the energy vertical only, not here.
          </p>
        </>
      );
    }
    return <IntelHomeSummary onOpenLive={onOpenLive} />;
  }

  if (isStsSelection(selection)) {
    return <STSEventPanel selection={selection} onNavigate={onNavigate} />;
  }

  if (selection._layer === "storage-sites") {
    return <StorageSitePanel selection={selection} />;
  }

  if (loading && !dossier) {
    const label = String(
      selection.name ?? (selection._layer === "pipelines" ? "Pipeline" : "Asset"),
    );
    const previewRows = [
      selection.operator ? { label: "operator (map)", value: String(selection.operator) } : null,
      selection.pipeline_status
        ? { label: "status (map)", value: String(selection.pipeline_status) }
        : null,
      selection.substance || selection.pipeline_substance
        ? { label: "substance (map)", value: String(selection.substance ?? selection.pipeline_substance) }
        : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>;
    return (
      <div className="dossier-tabbed">
        <div className="dossier-head">
          <h3 className="dossier-title">{label}</h3>
          <div className="dossier-head-badges">
            <span className="badge compact partial">loading…</span>
          </div>
        </div>
        {previewRows.length > 0 ? (
          <dl className="dossier-dl" style={{ marginTop: 8 }}>
            {previewRows.map((row) => (
              <span key={row.label} className="dossier-dl-row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </span>
            ))}
          </dl>
        ) : null}
        <p style={{ color: "var(--muted)", marginTop: 8 }}>
          {selection._layer === "pipelines"
            ? "Loading full GEM dossier from Postgres (not the spreadsheet at runtime)…"
            : "Loading dossier…"}
        </p>
      </div>
    );
  }
  if (error && !dossier) return <p style={{ color: "#f87171" }}>{error}</p>;
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
  const isPipelineDossier =
    dossier.entity_type === "asset" &&
    (String(summary.asset_type ?? "") === "pipeline" || selection._layer === "pipelines");
  const enrichment =
    dossier.entity_type === "asset" ? resolveAssetEnrichment(dossier) : null;
  const entityId = dossier.id || selection.id || "";

  return (
    <div className="dossier-tabbed">
      <div className="dossier-head">
        <h3 className="dossier-title">{dossier.name}</h3>
        <div className="dossier-head-badges">
          {loading && dossier.id ? (
            <span className="badge compact partial">refreshing…</span>
          ) : null}
          <span className={`badge compact ${confidenceTierClass(score, dossier.confidence?.status)}`}>
            {dossier.entity_type} · {score ?? "—"}
          </span>
          {dossier.opportunity_score != null && (
            <span className={`badge compact ${confidenceTierClass(dossier.opportunity_score)}`}>
              opp {Math.round(dossier.opportunity_score)}
            </span>
          )}
        </div>
      </div>

      {isPipelineDossier && pipelineMapFocused && onExitPipelineFocus ? (
        <div style={{ marginBottom: 10 }}>
          <button type="button" className="panel-btn" onClick={onExitPipelineFocus}>
            Show all pipelines
          </button>
          <p className="disclaimer" style={{ marginTop: 6, marginBottom: 0 }}>
            Map is filtered to this segment and linked facilities. Pan away or use this button to restore the full network.
          </p>
        </div>
      ) : null}

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
          <AssetOperatorCapacitySection dossier={dossier} onNavigateEntity={onNavigate} />
          <GemPipelineProfileSection dossier={dossier} />
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
            <ul className="dossier-list">
              {dossier.signals.map((s) => (
                <li key={`${s.signal_type}-${s.label}`}>
                  <span className="dossier-list-main">{s.label}</span>
                  <span className="dossier-list-meta">
                    {s.tier}
                    {s.detail ? ` — ${s.detail}` : ""}
                  </span>
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
            <ul className="dossier-list">
              {dossier.evidence.map((e) => (
                <li key={`${e.claim_type}-${e.source_name}`}>
                  <span className="dossier-list-main">
                    {e.claim_type}
                    {e.claim_value && (
                      <span className="dossier-list-value">
                        {" · "}
                        {e.claim_value.length > 48 ? `${e.claim_value.slice(0, 48)}…` : e.claim_value}
                      </span>
                    )}
                  </span>
                  <span className="dossier-list-meta">
                    {e.source_name}
                    {e.tier ? ` (${e.tier})` : ""}
                  </span>
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

      <StartDealPackLink dossier={dossier} selection={selection} vertical={vertical} />

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
