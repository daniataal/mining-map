"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, MapPin, Route } from "lucide-react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import {
  fetchIntelArbitrage,
  fetchIntelCargoMovements,
  fetchIntelImporters,
  fetchIntelInvestorPaths,
  fetchIntelOpportunities,
  fetchIntelSTSOpenVessels,
  fetchIntelSTSPredictions,
  normalizeEvidenceLabel,
  type IntelArbitrage,
  type IntelCargoMovement,
  type IntelInvestorPath,
  type IntelOpportunity,
  type IntelSTSPrediction,
  type IntelSTSOpenVessel,
} from "@/lib/energyApi";

type BrokerIntent = "find_supplier" | "find_buyer" | "track_cargo" | "sts_lead" | "compare_margin";
type STSSubFilter = "open" | "predicted" | "active" | "completed";
type MapPoint = { lat: number; lng: number };
type ChainMapPayload = { features: FeatureCollection; focus?: MapPoint | null };
type ChainPoint = MapPoint & {
  id: string;
  name: string;
  role: string;
  shortLabel: string;
  evidenceLabel: string;
};

type OpportunityOriginatorPanelProps = {
  onChainFocus?: (features: FeatureCollection, focus?: MapPoint | null) => void;
  onClearChainFocus?: () => void;
};

const INTENT_CHIPS: Array<{ id: BrokerIntent; label: string }> = [
  { id: "find_supplier", label: "Find supplier" },
  { id: "find_buyer", label: "Find buyer" },
  { id: "track_cargo", label: "Track cargo" },
  { id: "sts_lead", label: "STS lead" },
  { id: "compare_margin", label: "Compare margin" },
];

const STS_FILTERS: Array<{ id: STSSubFilter; label: string }> = [
  { id: "open", label: "Open vessels" },
  { id: "predicted", label: "Predicted pairs" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
];

const LANE_WATCH_KEY = "madsan_lane_watchlist_v1";

function fmtScore(value?: number): string {
  if (value == null || Number.isNaN(value)) return "0";
  return Math.round(value).toLocaleString();
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function coordinateFromRecord(value?: Record<string, unknown>): MapPoint | undefined {
  if (!value) return undefined;
  const nested = recordValue(value.coordinates);
  const lat = numberValue(nested?.latitude) ?? numberValue(nested?.lat) ?? numberValue(value.latitude) ?? numberValue(value.lat);
  const lng =
    numberValue(nested?.longitude) ??
    numberValue(nested?.lng) ??
    numberValue(nested?.lon) ??
    numberValue(value.longitude) ??
    numberValue(value.lng) ??
    numberValue(value.lon);
  if (lat == null || lng == null) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

function chainRole(value: string): string {
  switch (value) {
    case "supplier_asset":
    case "source_asset":
      return "supplier_asset";
    case "buyer_asset":
    case "demand_asset":
      return "buyer_asset";
    case "physical_route":
    case "route_or_terminal_access":
      return "physical_route";
    case "cargo_or_vessel":
    case "movement_clue":
      return "cargo_or_vessel";
    default:
      return value || "chain_point";
  }
}

function pointFeature(point: ChainPoint, extra: Record<string, unknown> = {}): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    properties: {
      rel: "opportunity_chain",
      role: point.role,
      name: point.name,
      short_label: point.shortLabel,
      evidence_label: point.evidenceLabel,
      ...extra,
    },
  };
}

function lineFeature(id: string, points: ChainPoint[], extra: Record<string, unknown> = {}): Feature<LineString> | null {
  if (points.length < 2) return null;
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) },
    properties: {
      id,
      rel: "opportunity_chain",
      role: "commercial_chain",
      geometry_source: "opportunity_originator",
      name: points.map((point) => point.name).filter(Boolean).join(" -> "),
      short_label: "Opportunity chain",
      evidence_label: "inferred",
      ...extra,
    },
  };
}

function investorChainNodes(item: IntelInvestorPath): Record<string, unknown>[] {
  return Array.isArray(item.control_chain)
    ? item.control_chain.filter((node): node is Record<string, unknown> => !!node && typeof node === "object")
    : [];
}

function chainStepName(node: Record<string, unknown>): string {
  return textValue(node.short_label) || textValue(node.step).replaceAll("_", " ") || "chain step";
}

function evidenceAssetName(opp: IntelOpportunity, role: "supplier_asset" | "buyer_asset"): string {
  const hit = opp.evidence?.find((item) => item.role === role);
  return typeof hit?.asset_name === "string" ? hit.asset_name : "";
}

function investorPathMapPayload(item: IntelInvestorPath, opportunityId?: string): ChainMapPayload {
  const investor = item.investor?.name || "reported investor";
  const chain = investorChainNodes(item);
  const points: ChainPoint[] = chain.flatMap((node, idx) => {
    const coord = coordinateFromRecord(node);
    if (!coord) return [];
    const step = textValue(node.step);
    const role = chainRole(textValue(node.role) || step);
    return [{
      id: `${item.id}-${step || idx}`,
      lat: coord.lat,
      lng: coord.lng,
      role,
      name: textValue(node.label) || textValue(node.asset) || chainStepName(node),
      shortLabel: textValue(node.short_label) || chainStepName(node),
      evidenceLabel: textValue(node.evidence_label) || "inferred",
    }];
  });
  const shared = {
    chain_kind: "investor_control_path",
    investor,
    commodity: item.commodity ?? "oil/gas",
    origin_country: item.origin_country ?? "",
    destination_country: item.destination_country ?? "",
    opportunity_id: opportunityId ?? item.opportunity_id ?? item.id.split(":")[0],
    thesis_preview: item.commercial_thesis ?? "",
  };
  const features: Array<Feature<Point> | Feature<LineString>> = points.map((point) => pointFeature(point, shared));
  const line = lineFeature(`investor-chain-${item.id}`, points, shared);
  if (line) features.unshift(line);
  return {
    features: { type: "FeatureCollection", features },
    focus: points[0] ? { lat: points[0].lat, lng: points[0].lng } : null,
  };
}

function quantityBand(opp: IntelOpportunity): string {
  const summary = recordValue(opp.cargo_summary);
  const low = numberValue(summary?.quantity_low) ?? numberValue(summary?.low);
  const high = numberValue(summary?.quantity_high) ?? numberValue(summary?.high);
  const unit = textValue(summary?.unit) || "t";
  if (low != null && high != null) return `${Math.round(low).toLocaleString()}–${Math.round(high).toLocaleString()} ${unit}`;
  const best = numberValue(summary?.quantity_best) ?? numberValue(summary?.best);
  if (best != null) return `~${Math.round(best).toLocaleString()} ${unit}`;
  return "";
}

function stressChip(opp: IntelOpportunity): { label: string; level: "high" | "medium" | "low" } {
  const buyer = numberValue(opp.market_pressure_summary?.buyer_pressure_score);
  const supplier = numberValue(opp.market_pressure_summary?.supplier_availability_score);
  const score = Math.max(buyer ?? 0, supplier ?? 0, opp.score ?? 0);
  if (score >= 70) return { label: "stress high", level: "high" };
  if (score >= 45) return { label: "stress medium", level: "medium" };
  return { label: "stress low", level: "low" };
}

function buildThesisSentence(opp: IntelOpportunity, path?: IntelInvestorPath | null): string {
  if (path?.commercial_thesis) return path.commercial_thesis;
  const supplier = evidenceAssetName(opp, "supplier_asset");
  const buyer = evidenceAssetName(opp, "buyer_asset");
  const buyerScore = numberValue(opp.market_pressure_summary?.buyer_pressure_score);
  const corridor = [opp.origin_country, opp.destination_country].filter(Boolean).join(" → ");
  const pressure =
    typeof buyerScore === "number" && buyerScore >= 55 ? `buyer pressure ${fmtScore(buyerScore)}` : "";
  return [
    `${opp.commodity ?? "Oil/gas"}${corridor ? ` ${corridor}` : ""}`,
    supplier || buyer ? `${supplier || "supplier"} → ${buyer || "buyer"}` : "lane opportunity",
    pressure,
  ]
    .filter(Boolean)
    .join(" — ");
}

function readLaneWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LANE_WATCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLaneWatchlist(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANE_WATCH_KEY, JSON.stringify(ids));
}

function stsStatusKind(item: IntelSTSPrediction): string {
  const payload = item.payload ?? {};
  return (textValue(payload.sts_kind) || textValue(payload.event_status) || "predicted").toLowerCase();
}

function ThesisCard({
  item,
  path,
  margin,
  watched,
  canMap,
  canContact,
  onShowMap,
  onWatch,
}: {
  item: IntelOpportunity;
  path?: IntelInvestorPath | null;
  margin?: IntelArbitrage | null;
  watched: boolean;
  canMap: boolean;
  canContact: boolean;
  onShowMap: () => void;
  onWatch: () => void;
}) {
  const evidence = normalizeEvidenceLabel(item.evidence_grade);
  const product = item.commodity ?? "oil/gas";
  const qty = quantityBand(item);
  const stress = stressChip(item);
  const thesis = buildThesisSentence(item, path);
  const marginHint = margin?.benchmarks?.[0];
  const marginPrice = numberValue(marginHint?.price);
  return (
    <article className="thesis-card">
      <p className="thesis-card-sentence">{thesis}</p>
      <div className="thesis-card-chips">
        <span className={`evidence-label evidence-label--${evidence}`}>{evidence}</span>
        <span className="thesis-chip">{product}</span>
        {qty ? <span className="thesis-chip">{qty}</span> : null}
        <span className={`thesis-chip thesis-chip--${stress.level}`}>{stress.label}</span>
        {marginPrice != null ? <span className="thesis-chip">benchmark ctx</span> : null}
      </div>
      <div className="thesis-card-actions">
        <Link href={`/intel/lane/${encodeURIComponent(item.id)}`} className="panel-btn">
          Open lane dossier
        </Link>
        <button type="button" className="panel-btn muted" disabled={!canMap} onClick={onShowMap}>
          <MapPin size={12} /> Show on map
        </button>
        <Link
          href={`/intel/lane/${encodeURIComponent(item.id)}?segment=act`}
          className={`panel-btn muted${canContact ? "" : " disabled-link"}`}
          aria-disabled={!canContact}
          tabIndex={canContact ? 0 : -1}
        >
          Contact
        </Link>
        <button type="button" className="panel-btn muted" disabled={!item.id} onClick={onWatch}>
          {watched ? "Watching" : "Watch"}
        </button>
      </div>
    </article>
  );
}

function CargoThesisCard({
  item,
  onShowMap,
}: {
  item: IntelCargoMovement;
  onShowMap: () => void;
}) {
  const qty = item.quantity?.best ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}` : "";
  const route = [item.load?.port || item.load?.country, item.discharge?.port || item.discharge?.country].filter(Boolean).join(" → ");
  const thesis = `${item.vessel_name || item.imo || "Vessel"} cargo clue${route ? ` on ${route}` : ""}${qty ? ` · ${qty}` : ""}`;
  const contacts = recordArray(item.commercial_chain?.contacts);
  return (
    <article className="thesis-card">
      <p className="thesis-card-sentence">{thesis}</p>
      <div className="thesis-card-chips">
        <span className={`evidence-label evidence-label--${normalizeEvidenceLabel(item.evidence_label)}`}>
          {normalizeEvidenceLabel(item.evidence_label)}
        </span>
        {item.product_family ? <span className="thesis-chip">{item.product_family}</span> : null}
        {qty ? <span className="thesis-chip">{qty}</span> : null}
      </div>
      <div className="thesis-card-actions">
        <button type="button" className="panel-btn muted" onClick={onShowMap}>
          <MapPin size={12} /> Show on map
        </button>
        <span className="thesis-card-note">
          {contacts.length > 0 ? "contacts in cargo chain" : "lane dossier pending for cargo-only clue"}
        </span>
      </div>
    </article>
  );
}

function STSCard({ item, kind }: { item: IntelSTSPrediction | IntelSTSOpenVessel; kind: STSSubFilter }) {
  const isOpen = "destination_hint" in item;
  let thesis = "";
  let product = "";
  let evidenceLabel = "";

  if (isOpen) {
    const open = item as IntelSTSOpenVessel;
    const name = open.vessel_name ?? "Open vessel";
    thesis = open.destination_hint ? `${name} · ${open.destination_hint}` : name;
    product = open.product_hint ?? "";
    evidenceLabel = open.evidence_label ?? "inferred";
  } else {
    const pred = item as IntelSTSPrediction;
    const payload = pred.payload ?? {};
    const a = textValue(payload.vessel_a_name) || textValue(payload.vessel_a);
    const b = textValue(payload.vessel_b_name) || textValue(payload.vessel_b);
    thesis = [a, b].filter(Boolean).join(" / ") || "Predicted STS pair";
    product = textValue(payload.product_hint);
    evidenceLabel = pred.evidence_label ?? (kind === "predicted" ? "predicted" : "inferred");
  }

  const evidence = normalizeEvidenceLabel(evidenceLabel);
  return (
    <article className="thesis-card">
      <p className="thesis-card-sentence">{thesis}</p>
      <div className="thesis-card-chips">
        <span className={`evidence-label evidence-label--${evidence}`}>{evidence}</span>
        {product ? <span className="thesis-chip">{product}</span> : null}
        <span className="thesis-chip">{STS_FILTERS.find((f) => f.id === kind)?.label ?? kind}</span>
      </div>
    </article>
  );
}

function GapList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="broker-gap-list">
      {items.map((item) => (
        <span key={item} className="commercial-gap">
          {item}
        </span>
      ))}
    </div>
  );
}

export default function OpportunityOriginatorPanel({
  onChainFocus,
  onClearChainFocus,
}: OpportunityOriginatorPanelProps) {
  const [intent, setIntent] = useState<BrokerIntent>("find_buyer");
  const [stsFilter, setStsFilter] = useState<STSSubFilter>("predicted");
  const [loading, setLoading] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [commodity, setCommodity] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [opportunities, setOpportunities] = useState<IntelOpportunity[]>([]);
  const [investorPaths, setInvestorPaths] = useState<IntelInvestorPath[]>([]);
  const [cargo, setCargo] = useState<IntelCargoMovement[]>([]);
  const [sts, setSts] = useState<IntelSTSPrediction[]>([]);
  const [stsOpen, setStsOpen] = useState<IntelSTSOpenVessel[]>([]);
  const [marginById, setMarginById] = useState<Record<string, IntelArbitrage | null>>({});
  const [watchedIds, setWatchedIds] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const role =
      intent === "find_supplier" ? "supplier" : intent === "find_buyer" ? "buyer" : undefined;
    const [nextOpps, nextCargo, nextPaths, nextSts, nextOpen] = await Promise.all([
      fetchIntelOpportunities({
        commodity: commodity || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
        role,
        limit: 30,
      }),
      fetchIntelCargoMovements({ commodity: commodity || undefined, country: origin || destination || undefined, limit: 12 }),
      fetchIntelInvestorPaths({
        commodity: commodity || undefined,
        origin: origin || undefined,
        destination: destination || undefined,
        limit: 30,
      }),
      fetchIntelSTSPredictions(20),
      fetchIntelSTSOpenVessels(12),
    ]);
    setOpportunities(nextOpps);
    setCargo(nextCargo);
    setInvestorPaths(nextPaths);
    setSts(nextSts);
    setStsOpen(nextOpen);
    setLoading(false);
  }, [commodity, destination, intent, origin]);

  useEffect(() => {
    setWatchedIds(readLaneWatchlist());
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (intent !== "compare_margin" || opportunities.length === 0) return;
    let cancelled = false;
    Promise.all(
      opportunities.slice(0, 8).map(async (item) => {
        const margin = await fetchIntelArbitrage({
          origin: item.origin_country,
          destination: item.destination_country,
          commodity: item.commodity,
        });
        return [item.id, margin] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      setMarginById(Object.fromEntries(rows));
    });
    return () => {
      cancelled = true;
    };
  }, [intent, opportunities]);

  const pathByOpportunity = useMemo(() => {
    const map = new Map<string, IntelInvestorPath>();
    for (const path of investorPaths) {
      const baseId = path.opportunity_id ?? path.id.split(":")[0];
      if (!map.has(baseId)) map.set(baseId, path);
    }
    return map;
  }, [investorPaths]);

  const rankedOpportunities = useMemo(() => {
    const list = [...opportunities];
    if (intent === "find_supplier") {
      list.sort((a, b) => (b.score_breakdown?.supplier_reality ?? 0) - (a.score_breakdown?.supplier_reality ?? 0));
    } else if (intent === "find_buyer") {
      list.sort((a, b) => (b.score_breakdown?.buyer_reality ?? 0) - (a.score_breakdown?.buyer_reality ?? 0));
    } else if (intent === "compare_margin") {
      list.sort((a, b) => (b.score_breakdown?.market_pressure ?? 0) - (a.score_breakdown?.market_pressure ?? 0));
    } else {
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    return list;
  }, [intent, opportunities]);

  const stsCards = useMemo(() => {
    if (stsFilter === "open") return stsOpen;
    if (stsFilter === "predicted") return sts.filter((item) => stsStatusKind(item).includes("predict"));
    if (stsFilter === "active") return sts.filter((item) => stsStatusKind(item).includes("active"));
    return sts.filter((item) => stsStatusKind(item).includes("complete"));
  }, [sts, stsFilter, stsOpen]);

  const stsGaps = useMemo(() => {
    if (intent !== "sts_lead") return [];
    const gaps: string[] = [];
    if (stsFilter === "open" && stsOpen.length === 0) gaps.push("open tonnage pending — no open-vessel STS lead yet");
    if (stsFilter === "predicted" && sts.filter((item) => stsStatusKind(item).includes("predict")).length === 0) {
      gaps.push("no predicted STS pair yet");
    }
    if (stsFilter === "active" && sts.filter((item) => stsStatusKind(item).includes("active")).length === 0) {
      gaps.push("no active STS event yet");
    }
    if (stsFilter === "completed" && sts.filter((item) => stsStatusKind(item).includes("complete")).length === 0) {
      gaps.push("no completed STS event yet");
    }
    return gaps;
  }, [intent, sts, stsFilter, stsOpen.length]);

  const publishPayload = (payload: ChainMapPayload) => {
    if (payload.features.features.length === 0) {
      onClearChainFocus?.();
      return;
    }
    onChainFocus?.(payload.features, payload.focus ?? null);
  };

  const showOpportunityOnMap = (item: IntelOpportunity) => {
    const path = pathByOpportunity.get(item.id);
    if (path) {
      publishPayload(investorPathMapPayload(path, item.id));
      return;
    }
    onClearChainFocus?.();
  };

  const toggleWatch = (id: string) => {
    setWatchedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      writeLaneWatchlist(next);
      return next;
    });
  };

  const hasContacts = (item: IntelOpportunity) => {
    const path = pathByOpportunity.get(item.id);
    return Boolean(path?.investor?.name || evidenceAssetName(item, "supplier_asset") || evidenceAssetName(item, "buyer_asset"));
  };

  return (
    <div className="opportunity-panel broker-home">
      <div className="broker-intent-row" role="tablist" aria-label="Broker intent">
        {INTENT_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={intent === chip.id}
            className={`broker-intent-chip${intent === chip.id ? " is-active" : ""}`}
            onClick={() => setIntent(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="broker-filter-row">
        <label>
          <small>Commodity</small>
          <input
            value={commodity}
            onChange={(e) => setCommodity(e.target.value)}
            placeholder="oil, lng…"
          />
        </label>
        <label>
          <small>Origin</small>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="country" />
        </label>
        <label>
          <small>Destination</small>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="country" />
        </label>
        <button type="button" className="panel-btn muted broker-filter-apply" onClick={() => void loadData()}>
          Apply
        </button>
      </div>

      <button
        type="button"
        className="broker-advanced-toggle"
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        Advanced filters
        {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {advancedOpen && (
        <div className="broker-advanced-panel">
          <span className="commercial-gap">map bbox filter pending</span>
          <span className="commercial-gap">min score filter pending</span>
        </div>
      )}

      {intent === "sts_lead" && (
        <div className="broker-sts-filters" role="tablist" aria-label="STS sub-filters">
          {STS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              role="tab"
              aria-selected={stsFilter === filter.id}
              className={`broker-sts-chip${stsFilter === filter.id ? " is-active" : ""}`}
              onClick={() => setStsFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      <div className="opportunity-kpis broker-kpis">
        <div>
          <Route size={15} />
          <strong>{opportunities.length}</strong>
          <span>lanes</span>
        </div>
        <div>
          <strong>{investorPaths.length}</strong>
          <span>chains</span>
        </div>
      </div>

      {loading && <p className="opportunity-muted">Loading broker leads…</p>}

      {!loading && intent === "track_cargo" && (
        <div className="thesis-card-stack">
          {cargo.length === 0 ? <GapList items={["cargo movement pending", "open tonnage pending"]} /> : null}
          {cargo.map((item) => (
            <CargoThesisCard key={`${item.source}-${item.id}`} item={item} onShowMap={() => onClearChainFocus?.()} />
          ))}
        </div>
      )}

      {!loading && intent === "sts_lead" && (
        <div className="thesis-card-stack">
          <GapList items={stsGaps} />
          {stsCards.length === 0 ? null : stsCards.map((item) => (
            <STSCard
              key={"destination_hint" in item ? item.id : item.id}
              item={item}
              kind={stsFilter}
            />
          ))}
        </div>
      )}

      {!loading && intent !== "track_cargo" && intent !== "sts_lead" && (
        <div className="thesis-card-stack">
          {rankedOpportunities.length === 0 ? (
            <GapList items={["counterparty intent pending", "repeat lane pending"]} />
          ) : null}
          {rankedOpportunities.map((item) => {
            const path = pathByOpportunity.get(item.id);
            return (
              <ThesisCard
                key={item.id}
                item={item}
                path={path}
                margin={marginById[item.id]}
                watched={watchedIds.includes(item.id)}
                canMap={Boolean(path)}
                canContact={hasContacts(item)}
                onShowMap={() => showOpportunityOnMap(item)}
                onWatch={() => toggleWatch(item.id)}
              />
            );
          })}
        </div>
      )}

      <p className="disclaimer">
        Intent → thesis card → lane dossier. Evidence labels separate observed, reported, inferred, estimated, and predicted
        intelligence. Margin and benchmark chips are indicative scenario context only.
      </p>
    </div>
  );
}
