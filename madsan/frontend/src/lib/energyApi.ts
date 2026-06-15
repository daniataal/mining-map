import type { FeatureCollection } from "geojson";
import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

export type ShipvaultFleetVessel = {
  name?: string;
  imo?: string;
  mmsi?: string;
  dwt?: number;
  gt?: number;
  type?: string;
  built_year?: number;
  flag?: string;
  shipvault_vessel_id?: string;
};

export type ShipvaultCompany = {
  shipvault_company_id: string;
  name: string;
  country?: string;
  city?: string;
  fleet_size?: number;
  total_dwt?: number;
  total_gt?: number;
  avg_age_years?: number;
  fleet_list?: ShipvaultFleetVessel[];
  madsan_company_id?: string;
  tier?: string;
  fetched_at?: string;
  stale_after?: string;
};

export type PortCallRecord = {
  terminal_name?: string;
  country?: string;
  event_type?: string;
  commodity_family?: string;
  arrival_ts?: string;
  departure_ts?: string;
  confidence_score?: number;
  tier: string;
  source: string;
  status?: string;
};

export type UnknownSupplierLead = {
  country_code?: string;
  commodity?: string;
  asset_count?: number;
  gap_score?: number;
  corridor_label?: string;
  message?: string;
};

export type MCRScaffoldStatus = {
  tier: string;
  status: string;
  message: string;
  limitations?: string[];
};

export type IntelOpportunity = {
  id: string;
  opportunity_type?: string;
  commodity?: string;
  origin_country?: string;
  destination_country?: string;
  supplier_company_id?: string;
  buyer_company_id?: string;
  supplier_asset_id?: string;
  buyer_asset_id?: string;
  vessel_id?: string;
  lane_id?: string;
  score?: number;
  confidence_score?: number;
  evidence_grade?: string;
  score_breakdown?: {
    supplier_reality?: number;
    buyer_reality?: number;
    market_pressure?: number;
    route_feasibility?: number;
    price_context?: number;
    investor_control?: number;
    risk_discount?: number;
  };
  route_summary?: Record<string, unknown>;
  cargo_summary?: Record<string, unknown>;
  market_pressure_summary?: Record<string, unknown>;
  price_context?: Record<string, unknown>;
  evidence?: Array<Record<string, unknown>>;
  limitations?: string[];
  tier?: string;
  generated_at?: string;
  expires_at?: string;
};

export type IntelCargoMovement = {
  id: string;
  source?: string;
  vessel_id?: string;
  voyage_id?: string;
  vessel_name?: string;
  imo?: string;
  mmsi?: string;
  vessel_class?: string;
  owner_name?: string;
  operator_name?: string;
  product_family?: string;
  load?: { port?: string; country?: string };
  discharge?: { port?: string; country?: string };
  route_hint?: {
    source?: string;
    confidence_score?: number;
    latest_destination?: string;
    decoded_destination?: Record<string, unknown>;
  };
  quantity?: { low?: number; best?: number; high?: number; unit?: string; method?: string };
  confidence?: number;
  observed_at?: string;
  evidence_label?: string;
  asset_context?: Record<string, unknown>;
  linkage?: string;
  limitations?: string[];
  commercial_chain?: Record<string, unknown>;
};

export type IntelSTSPrediction = {
  id: string;
  signal_type?: string;
  confidence_score?: number;
  horizon_hours?: number;
  payload?: Record<string, unknown>;
  predicted_at?: string;
  expires_at?: string;
  evidence_label?: string;
};

export type IntelArbitrage = {
  origin?: string;
  destination?: string;
  commodity?: string;
  benchmarks?: Array<Record<string, unknown>>;
  landed_margin?: Record<string, unknown>;
  limitations?: string[];
};

export type IntelImporter = {
  company_id?: string;
  name?: string;
  product_code?: string;
  product_name?: string;
  origin_country?: { country_code?: string };
  quantity?: { value?: number; unit?: string };
  rows?: number;
  latest_month?: string;
  port_count?: number;
  port_states?: string[];
  evidence_label?: string;
  source?: string;
};

export type IntelInvestorPath = {
  id: string;
  opportunity_id?: string;
  lane_id?: string;
  commodity?: string;
  origin_country?: string;
  destination_country?: string;
  score?: number;
  confidence_score?: number;
  investor_control_score?: number;
  evidence_grade?: string;
  evidence_label?: string;
  investor?: {
    entity_id?: string;
    name?: string;
    exposure_role?: string;
    exposure_count?: number;
    exposure_value?: number;
    exposure_unit?: string;
    exposure_types?: string[];
    confidence_score?: number;
  };
  commercial_thesis?: string;
  supplier?: Record<string, unknown>;
  buyer?: Record<string, unknown>;
  route?: Record<string, unknown>;
  market?: Record<string, unknown>;
  cargo?: Record<string, unknown>;
  price_context?: Record<string, unknown>;
  exposures?: Array<Record<string, unknown>>;
  control_chain?: Array<Record<string, unknown>>;
  chain_segments?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  limitations?: string[];
  generated_at?: string;
};

export type IntelCommercialProfile = {
  id?: string;
  type?: "asset" | "company" | "vessel" | string;
  name?: string;
  country_code?: string;
  asset_type?: string;
  vessel_type?: string;
  vessel_class?: string;
  imo?: string;
  mmsi?: string;
  deadweight_tons?: number;
  commodities?: string[];
  roles?: string[];
  owner?: Record<string, unknown>;
  operator?: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  commercial_contacts?: Array<Record<string, unknown>>;
  commercial_chain_bundle?: Record<string, unknown>;
  ownership_chain?: Array<Record<string, unknown>>;
  ownership_intel?: Record<string, unknown>;
  investor_exposures?: Array<Record<string, unknown>>;
  name_history?: Array<Record<string, unknown>>;
  owner_profile?: Record<string, unknown>;
  assets?: Array<Record<string, unknown>>;
  trade_flow_summary?: Array<Record<string, unknown>>;
  linked_intel?: {
    entity_type?: string;
    entity_id?: string;
    entity_name?: string;
    evidence_label?: string;
    investor_paths?: IntelInvestorPath[];
    opportunities?: IntelOpportunity[];
    cargo_movements?: IntelCargoMovement[];
    importers?: IntelImporter[];
    sts_predictions?: IntelSTSPrediction[];
    market_pressure?: Array<Record<string, unknown>>;
    benchmarks?: Array<Record<string, unknown>>;
    assets?: Array<Record<string, unknown>>;
    ownership_chain?: Array<Record<string, unknown>>;
    investor_exposures?: Array<Record<string, unknown>>;
    limitations?: string[];
  };
  confidence_score?: number;
  evidence_label?: string;
};

export type DossierTabKey =
  | "chain"
  | "cargo"
  | "buyers"
  | "suppliers"
  | "ownership"
  | "contacts"
  | "market"
  | "risk";

export type DossierSectionItem = {
  id: string;
  evidenceLabel: string;
  title: string;
  meta?: string;
  lines: string[];
  raw?: Record<string, unknown>;
};

export type DossierGap = {
  key: string;
  label: string;
  unlockHint?: string;
};

export type DossierWorkspaceView = {
  entityType: "asset" | "company" | "vessel";
  entityName?: string;
  evidenceCount: number;
  tabs: Record<
    DossierTabKey,
    {
      count: number;
      items: DossierSectionItem[];
      gaps: DossierGap[];
    }
  >;
  riskNotes: string[];
  limitations: string[];
};

const DOSSIER_EVIDENCE_LABELS = new Set([
  "inferred",
  "reported",
  "estimated",
  "predicted",
  "source-backed",
  "observed",
]);

function dossierText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dossierNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function dossierRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function dossierRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function dossierShortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dossierFmtScore(value?: number): string {
  if (value == null || Number.isNaN(value)) return "";
  return Math.round(value).toLocaleString();
}

function dossierFmtCompact(value: unknown): string {
  const n = dossierNumber(value);
  if (n == null || n === 0) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function dossierChainStepName(node: Record<string, unknown>): string {
  return (
    dossierText(node.short_label) ||
    dossierText(node.step).replaceAll("_", " ") ||
    "step"
  );
}

function dossierMergeKey(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  const rec = item as Record<string, unknown>;
  if (typeof rec.id === "string" && rec.id) return rec.id;
  if (typeof rec.company_id === "string" && rec.company_id) {
    return `${rec.company_id}-${dossierText(rec.product_code)}`;
  }
  return JSON.stringify(item);
}

export function normalizeEvidenceLabel(value?: string): string {
  if (!value) return "inferred";
  const normalized = value.toLowerCase().trim().replace(/_/g, "-");
  if (DOSSIER_EVIDENCE_LABELS.has(normalized)) return normalized;
  if (normalized.includes("observ") || normalized === "mixed") return "observed";
  if (normalized.includes("source") || normalized.includes("report")) return "source-backed";
  if (normalized.includes("predict")) return "predicted";
  if (normalized.includes("estimat")) return "estimated";
  if (normalized.includes("infer")) return "inferred";
  return "reported";
}

export function mergeIntelArrays<T>(...arrays: Array<T[] | undefined | null>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const arr of arrays) {
    if (!arr) continue;
    for (const item of arr) {
      const key = dossierMergeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function dossierEntityType(value?: string): "asset" | "company" | "vessel" {
  const clean = (value ?? "asset").toLowerCase().replace(/s$/, "");
  if (clean === "company") return "company";
  if (clean === "vessel") return "vessel";
  return "asset";
}

function dossierContactLabel(item: Record<string, unknown>): string {
  return dossierText(item.role).replaceAll("_", " ") || dossierText(item.tier) || "contact";
}

function dossierBestContactLine(item: Record<string, unknown>): string {
  const nested = dossierRecordArray(item.contacts);
  const firstNested = nested[0];
  return [
    dossierText(item.email) || dossierText(firstNested?.email),
    dossierText(item.phone) || dossierText(firstNested?.phone),
    dossierText(item.website),
    dossierText(item.source_url) ||
      dossierText(item.register_source_url) ||
      dossierText(item.source_ref),
  ]
    .filter(Boolean)
    .join(" · ");
}

function dossierOwnershipRows(profile: IntelCommercialProfile): Record<string, unknown>[] {
  const linked = dossierRecord(profile.linked_intel);
  const rows = mergeIntelArrays(
    dossierRecordArray(profile.ownership_chain),
    dossierRecordArray(linked?.ownership_chain),
  );
  const ownershipIntel = dossierRecord(profile.ownership_intel);
  rows.push(...dossierRecordArray(ownershipIntel?.history_candidates));
  rows.push(...dossierRecordArray(ownershipIntel?.registry_checks));
  return rows;
}

function dossierCargoChainContacts(cargo: IntelCargoMovement[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const item of cargo) {
    const chain = dossierRecord(item.commercial_chain);
    out.push(...dossierRecordArray(chain?.contacts));
    out.push(...dossierRecordArray(chain?.commercial_contacts));
  }
  return out;
}

function dossierPathItem(item: IntelInvestorPath): DossierSectionItem {
  const chain = dossierRecordArray(item.control_chain);
  const lines = [
    item.commercial_thesis,
    ...chain.slice(0, 7).map(
      (node) =>
        `${dossierChainStepName(node)}: ${dossierText(node.label) || dossierText(node.asset)}`,
    ),
  ].filter((line): line is string => !!line);
  return {
    id: item.id,
    evidenceLabel: normalizeEvidenceLabel(item.evidence_label ?? item.evidence_grade),
    title: item.investor?.name || "reported investor path",
    meta: dossierFmtScore(item.score),
    lines,
    raw: item as unknown as Record<string, unknown>,
  };
}

function dossierOpportunityItem(item: IntelOpportunity): DossierSectionItem {
  const supplier = item.evidence?.find((evidence) => dossierText(evidence.role) === "supplier_asset");
  const buyer = item.evidence?.find((evidence) => dossierText(evidence.role) === "buyer_asset");
  const lines = [
    `${dossierText(supplier?.asset_name) || "supplier side"} -> ${dossierText(buyer?.asset_name) || "buyer side"}`,
    `supplier ${dossierFmtScore(item.score_breakdown?.supplier_reality)} · buyer ${dossierFmtScore(item.score_breakdown?.buyer_reality)} · market ${dossierFmtScore(item.score_breakdown?.market_pressure)}`,
  ];
  return {
    id: item.id,
    evidenceLabel: normalizeEvidenceLabel(item.evidence_grade),
    title: `${item.commodity ?? "oil/gas"} · ${item.origin_country ?? "?"} -> ${item.destination_country ?? "?"}`,
    meta: dossierFmtScore(item.score),
    lines,
    raw: item as unknown as Record<string, unknown>,
  };
}

function dossierCargoItem(item: IntelCargoMovement): DossierSectionItem {
  const qty = item.quantity?.best
    ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}`
    : "";
  const assetContext = dossierRecord(item.asset_context);
  const contextName =
    dossierText(assetContext?.asset_name) ||
    dossierText(assetContext?.name);
  const contextDistance = dossierFmtCompact(assetContext?.distance_km);
  const lines = [
    qty,
    item.owner_name ? `owner ${item.owner_name}` : "",
    item.operator_name ? `operator ${item.operator_name}` : "",
    contextName
      ? `context terminal ${contextName}${contextDistance ? ` · ${contextDistance} km` : ""}`
      : "",
    item.linkage === "nearby_terminal_cluster_context" ? "nearby cluster, not exact asset" : "",
    item.route_hint?.latest_destination ? `dest ${item.route_hint.latest_destination}` : "",
    item.load?.port || item.load?.country
      ? `load ${[item.load.port, item.load.country].filter(Boolean).join(", ")}`
      : "",
    item.discharge?.port || item.discharge?.country
      ? `discharge ${[item.discharge.port, item.discharge.country].filter(Boolean).join(", ")}`
      : "",
  ].filter(Boolean);
  return {
    id: `${item.source ?? "cargo"}-${item.id}`,
    evidenceLabel: normalizeEvidenceLabel(item.evidence_label),
    title: item.vessel_name || item.imo || item.mmsi || "cargo movement",
    meta: item.product_family,
    lines,
    raw: item as unknown as Record<string, unknown>,
  };
}

function dossierCargoChainItem(item: IntelCargoMovement): DossierSectionItem | null {
  const chain = dossierRecord(item.commercial_chain);
  const steps = dossierRecordArray(chain?.chain_steps);
  if (steps.length === 0) return null;
  const lines = steps.slice(0, 10).map((step) => {
    const label = dossierText(step.label) || dossierText(step.asset) || dossierText(step.name);
    return `${dossierChainStepName(step)}: ${label || "unlabeled step"}`;
  });
  return {
    id: `cargo-chain-${item.source ?? "cargo"}-${item.id}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(chain?.evidence_label) || item.evidence_label),
    title: "Cargo commercial chain",
    meta: `${steps.length} step${steps.length === 1 ? "" : "s"}`,
    lines,
    raw: chain ?? (item as unknown as Record<string, unknown>),
  };
}

function dossierCommercialBundleItem(bundle: Record<string, unknown> | undefined): DossierSectionItem | null {
  if (!bundle) return null;
  const steps = dossierRecordArray(bundle.chain_steps);
  if (steps.length === 0) return null;
  const entity = dossierRecord(bundle.entity);
  const lines = steps.slice(0, 12).map((step) => {
    const label =
      dossierText(step.label) ||
      dossierText(step.asset) ||
      dossierText(step.name) ||
      dossierText(step.company_id) ||
      dossierText(step.asset_id);
    const role = dossierText(step.role).replaceAll("_", " ");
    const distance = dossierFmtCompact(step.distance_km);
    const detail = [
      role && role !== dossierChainStepName(step) ? role : "",
      distance ? `${distance} km` : "",
    ].filter(Boolean).join(" · ");
    return `${dossierChainStepName(step)}: ${label || "unlabeled step"}${detail ? ` (${detail})` : ""}`;
  });
  const contactability = dossierRecord(bundle.contactability);
  const directChannels = dossierFmtCompact(contactability?.direct_channels);
  const sourceLinks = dossierFmtCompact(contactability?.source_links);
  if (directChannels || sourceLinks) {
    lines.push(`outreach ${directChannels || "0"} direct · ${sourceLinks || "0"} source links`);
  }
  return {
    id: `commercial-chain-${dossierText(entity?.id) || dossierText(entity?.name) || "entity"}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(bundle.evidence_label) || "mixed"),
    title: `${dossierText(entity?.name) || "Commercial"} chain bundle`,
    meta: `${steps.length} step${steps.length === 1 ? "" : "s"}`,
    lines,
    raw: bundle,
  };
}

function dossierStsItem(item: IntelSTSPrediction): DossierSectionItem {
  const payload = item.payload ?? {};
  const lines = [
    dossierText(payload.product_hint),
    item.horizon_hours ? `${item.horizon_hours}h horizon` : "",
    dossierText(payload.zone_hint) || dossierText(payload.location_hint),
  ].filter(Boolean);
  return {
    id: item.id,
    evidenceLabel: normalizeEvidenceLabel(item.evidence_label),
    title:
      [payload.vessel_a_name, payload.vessel_b_name]
        .map((value) => String(value ?? ""))
        .filter(Boolean)
        .join(" / ") || "STS pair",
    meta: item.confidence_score != null ? `${dossierFmtScore(item.confidence_score)} confidence` : undefined,
    lines,
    raw: item as unknown as Record<string, unknown>,
  };
}

function dossierImporterItem(item: IntelImporter, idx: number): DossierSectionItem {
  const lines = [
    [
      item.origin_country?.country_code ? `from ${item.origin_country.country_code}` : "",
      dossierFmtCompact(item.quantity?.value),
      item.quantity?.unit,
      item.latest_month ? dossierShortDate(item.latest_month) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    item.port_count ? `${item.port_count} ports` : "",
  ].filter(Boolean);
  return {
    id: `${item.company_id || item.name || "importer"}-${item.product_code ?? idx}`,
    evidenceLabel: normalizeEvidenceLabel(item.evidence_label),
    title: item.name || "reported importer",
    meta: item.product_code,
    lines,
    raw: item as unknown as Record<string, unknown>,
  };
}

function dossierTradeFlowItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const lines = [
    [
      dossierText(item.origin_country_code) ? `from ${dossierText(item.origin_country_code)}` : "",
      dossierFmtCompact(item.quantity_value),
      dossierText(item.quantity_unit),
      dossierText(item.latest_month) ? dossierShortDate(dossierText(item.latest_month)) : "",
    ]
      .filter(Boolean)
      .join(" · "),
    dossierText(item.product_name) || dossierText(item.product_code),
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `trade-flow-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || dossierText(item.tier)),
    title: dossierText(item.product_name) || dossierText(item.product_code) || "trade flow",
    meta: dossierFmtCompact(item.rows) ? `${dossierFmtCompact(item.rows)} rows` : undefined,
    lines,
    raw: item,
  };
}

function dossierAssetItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const lines = [
    dossierText(item.asset_type) || dossierText(item.type),
    dossierText(item.country_code),
    dossierText(item.operator_name) ? `operator ${dossierText(item.operator_name)}` : "",
    dossierText(item.owner_name) ? `owner ${dossierText(item.owner_name)}` : "",
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `asset-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || dossierText(item.tier)),
    title: dossierText(item.name) || "linked asset",
    meta: dossierText(item.asset_type) || dossierText(item.role),
    lines,
    raw: item,
  };
}

function dossierOwnershipItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const parent = dossierRecord(item.parent);
  const lines = [
    dossierText(item.operator_name),
    dossierText(item.detail),
    dossierText(item.previous_ownership_status),
    dossierText(item.previous_name),
    dossierText(item.registry_source),
  ].filter(Boolean);
  return {
    id:
      dossierText(item.owner_entity_id) ||
      dossierText(item.label) ||
      dossierText(item.name) ||
      `ownership-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(
      dossierText(item.evidence_label) || dossierText(item.status),
    ),
    title:
      dossierText(item.owner_name) ||
      dossierText(item.label) ||
      dossierText(item.name) ||
      dossierText(item.check) ||
      "ownership evidence",
    meta: dossierText(item.parent_name) || dossierText(parent?.name) || dossierText(item.source),
    lines: lines.length > 0 ? lines : ["ownership, registry, or historical identity clue"],
    raw: item,
  };
}

function dossierExposureItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const lines = [
    [dossierText(item.commodity), dossierText(item.country_code), dossierText(item.exposure_unit)]
      .filter(Boolean)
      .join(" · "),
    dossierText(item.exposure_role),
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `exposure-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(
      dossierText(item.evidence_label) || dossierText(item.exposure_type) || "investor",
    ),
    title: dossierText(item.investor_name) || "investor exposure",
    meta: dossierFmtCompact(item.exposure_value),
    lines,
    raw: item,
  };
}

function dossierContactItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const line = dossierBestContactLine(item);
  return {
    id: dossierText(item.company_id) || dossierText(item.name) || `contact-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(
      dossierText(item.evidence_label) || dossierContactLabel(item),
    ),
    title: dossierText(item.name) || dossierText(item.company_id) || "source-backed contact",
    meta: dossierText(item.country_code) || dossierText(item.shipvault_country),
    lines: line ? [line] : ["source-backed contact bundle"],
    raw: item,
  };
}

function dossierOwnerOperatorItem(
  role: "owner" | "operator",
  item: Record<string, unknown> | undefined,
): DossierSectionItem | null {
  if (!item) return null;
  const name = dossierText(item.name);
  const companyId = dossierText(item.company_id);
  if (!name && !companyId) return null;
  return {
    id: `${role}-${companyId || name}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || "reported"),
    title: name || companyId,
    meta: role,
    lines: [companyId, dossierText(item.country_code)].filter(Boolean),
    raw: item,
  };
}

function dossierNameHistoryItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const lines = [
    dossierText(item.effective_from) ? `from ${dossierShortDate(dossierText(item.effective_from))}` : "",
    dossierText(item.effective_to) ? `to ${dossierShortDate(dossierText(item.effective_to))}` : "",
    dossierText(item.source),
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `name-history-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || "reported"),
    title: dossierText(item.name) || dossierText(item.previous_name) || "previous name",
    meta: dossierText(item.imo) || dossierText(item.mmsi),
    lines: lines.length > 0 ? lines : ["historical vessel identity"],
    raw: item,
  };
}

function dossierMarketPressureItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const lines = [
    dossierText(item.signal_type) || dossierText(item.metric),
    dossierText(item.direction),
    dossierText(item.period),
    dossierText(item.summary) || dossierText(item.message),
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `market-pressure-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || "estimated"),
    title: dossierText(item.label) || dossierText(item.signal_type) || "market stress",
    meta: dossierText(item.commodity) || dossierText(item.country_code),
    lines,
    raw: item,
  };
}

function dossierBenchmarkItem(item: Record<string, unknown>, idx: number): DossierSectionItem {
  const benchmark = dossierText(item.benchmark) || dossierText(item.name) || "benchmark";
  const price = dossierFmtCompact(item.price) || dossierFmtCompact(item.value);
  const unit = dossierText(item.unit);
  const currency = dossierText(item.currency) || "USD";
  const lines = [
    dossierText(item.source) ? `source ${dossierText(item.source)}` : "",
    dossierText(item.period) || dossierShortDate(dossierText(item.observed_at)),
    "indicative only",
  ].filter(Boolean);
  return {
    id: dossierText(item.id) || `${benchmark}-${idx}`,
    evidenceLabel: normalizeEvidenceLabel(dossierText(item.evidence_label) || "source-backed"),
    title: `${benchmark} benchmark context`,
    meta: price ? `${price} ${currency}${unit}` : dossierText(item.commodity),
    lines,
    raw: item,
  };
}

function dossierGap(key: string, label: string, unlockHint?: string): DossierGap {
  return unlockHint ? { key, label, unlockHint } : { key, label };
}

export function shapeDossierWorkspace(
  profile: IntelCommercialProfile | null,
  fallbackEntityType?: "asset" | "company" | "vessel",
): DossierWorkspaceView {
  const entityType = dossierEntityType(profile?.type ?? fallbackEntityType);
  const linked = profile?.linked_intel;
  const commercialBundle = dossierRecord(profile?.commercial_chain_bundle);
  const bundleLimitations = Array.isArray(commercialBundle?.limitations)
    ? commercialBundle.limitations.filter((line): line is string => typeof line === "string")
    : [];
  const paths = linked?.investor_paths ?? [];
  const opportunities = linked?.opportunities ?? [];
  const cargo = mergeIntelArrays(linked?.cargo_movements);
  const sts = linked?.sts_predictions ?? [];
  const importers = mergeIntelArrays(linked?.importers, dossierRecordArray(commercialBundle?.buyers) as IntelImporter[]);
  const marketPressure = mergeIntelArrays(
    dossierRecordArray(linked?.market_pressure),
    dossierRecordArray(commercialBundle?.market_pressure),
  );
  const benchmarks = mergeIntelArrays(
    dossierRecordArray(linked?.benchmarks),
    dossierRecordArray(commercialBundle?.benchmarks),
  );
  const exposures = mergeIntelArrays(
    dossierRecordArray(profile?.investor_exposures),
    dossierRecordArray(linked?.investor_exposures),
    dossierRecordArray(commercialBundle?.investor_exposures),
  );
  const ownership = mergeIntelArrays(
    dossierOwnershipRows(profile ?? {}),
    dossierRecordArray(commercialBundle?.ownership),
    dossierRecordArray(commercialBundle?.previous_owner_candidates),
    dossierRecordArray(commercialBundle?.registry_checks),
  );
  const contacts = mergeIntelArrays(
    dossierRecordArray(profile?.commercial_contacts),
    dossierRecordArray(profile?.contacts),
    dossierRecordArray(commercialBundle?.contacts),
    dossierCargoChainContacts(cargo),
  );
  const assets = mergeIntelArrays(
    dossierRecordArray(profile?.assets),
    dossierRecordArray(linked?.assets),
  );
  const tradeFlows = dossierRecordArray(profile?.trade_flow_summary);
  const nameHistory = dossierRecordArray(profile?.name_history);

  const ownerItem = dossierOwnerOperatorItem("owner", dossierRecord(profile?.owner));
  const operatorItem = dossierOwnerOperatorItem("operator", dossierRecord(profile?.operator));

  const cargoChainItems = cargo
    .map(dossierCargoChainItem)
    .filter((item): item is DossierSectionItem => item !== null);
  const bundleItem = dossierCommercialBundleItem(commercialBundle);
  const chainItems = [
    ...(bundleItem ? [bundleItem] : []),
    ...paths.map(dossierPathItem),
    ...cargoChainItems,
  ];
  const supplierItems = opportunities.map(dossierOpportunityItem);
  const cargoItems = [
    ...cargo.map(dossierCargoItem),
    ...sts.map(dossierStsItem),
  ];
  const buyerItems = [
    ...importers.map(dossierImporterItem),
    ...tradeFlows.map(dossierTradeFlowItem),
  ];
  const ownershipItems = [
    ...(ownerItem ? [ownerItem] : []),
    ...(operatorItem ? [operatorItem] : []),
    ...ownership.map(dossierOwnershipItem),
    ...exposures.map(dossierExposureItem),
    ...nameHistory.map(dossierNameHistoryItem),
  ];
  const contactItems = contacts.map(dossierContactItem);
  const marketItems = [
    ...marketPressure.map(dossierMarketPressureItem),
    ...benchmarks.map(dossierBenchmarkItem),
  ];

  const chainGaps: DossierGap[] = [];
  if (chainItems.length === 0) {
    chainGaps.push(
      dossierGap(
        "chain_pending",
        entityType === "vessel" ? "route stress pending" : "repeat lane pending",
        "Investor/control path or recurring lane evidence would unlock this section.",
      ),
    );
    if (entityType !== "vessel") {
      chainGaps.push(
        dossierGap(
          "counterparty_intent",
          "counterparty intent pending",
          "Buyer/supplier intent signals are not linked to this entity yet.",
        ),
      );
    }
  }

  const cargoGaps: DossierGap[] = [];
  if (cargo.length === 0) {
    cargoGaps.push(
      dossierGap(
        "cargo_pending",
        "inferred cargo pending",
        "AIS destination, port calls, or voyage evidence would unlock cargo clues.",
      ),
    );
  }
  if (entityType === "vessel" && sts.length === 0) {
    cargoGaps.push(
      dossierGap("sts_open_lead", "no open-vessel STS lead yet", "Open-to-STS vessel leads are not attached yet."),
    );
    cargoGaps.push(
      dossierGap("sts_predicted_pair", "no predicted STS pair yet", "Proximity/route STS predictions would appear here."),
    );
    cargoGaps.push(
      dossierGap("sts_event", "no active/completed STS event yet", "Observed STS events would appear when available."),
    );
  }

  const buyerGaps: DossierGap[] = [];
  if (buyerItems.length === 0) {
    buyerGaps.push(
      dossierGap(
        "buyers_pending",
        "buyer pressure pending",
        "Importer records or trade-flow summary would unlock buyer evidence.",
      ),
    );
  }

  const supplierGaps: DossierGap[] = [];
  if (supplierItems.length === 0) {
    supplierGaps.push(
      dossierGap(
        "suppliers_pending",
        "supplier availability pending",
        "Scored lane opportunities would unlock supplier-side evidence.",
      ),
    );
    if (entityType === "company") {
      supplierGaps.push(
        dossierGap("open_tonnage", "open tonnage pending", "Vessel availability by route/class is not linked yet."),
      );
    }
  }

  const ownershipGaps: DossierGap[] = [];
  if (ownershipItems.length === 0) {
    ownershipGaps.push(
      dossierGap(
        "ownership_pending",
        "previous ownership check pending",
        "Registry checks, owner/operator links, or name history would unlock ownership.",
      ),
    );
  } else if (!ownerItem && entityType === "vessel") {
    ownershipGaps.push(
      dossierGap(
        "weak_owner",
        "weak ownership evidence",
        "Source-backed owner title or registry confirmation is still missing.",
      ),
    );
  }

  const contactGaps: DossierGap[] = [];
  if (contactItems.length === 0) {
    contactGaps.push(
      dossierGap(
        "contacts_pending",
        "outreach pack pending",
        "Commercial contacts or manager bundles would unlock outreach pivots.",
      ),
    );
  }

  const marketGaps: DossierGap[] = [];
  if (marketItems.length === 0) {
    marketGaps.push(dossierGap("pink_sheet", "Pink Sheet adapter pending"));
    marketGaps.push(dossierGap("freight_curve", "freight curve pending"));
    marketGaps.push(dossierGap("quality_adjustment", "quality adjustment pending"));
    marketGaps.push(dossierGap("landed_margin", "landed margin pending"));
    if (entityType === "asset") {
      marketGaps.push(
        dossierGap("tank_stress", "tank stress pending", "Terminal inventory draw/build signals are not linked yet."),
      );
    }
    if (entityType === "company") {
      marketGaps.push(
        dossierGap("feedstock_fit", "feedstock fit pending", "Crude quality compatibility context is not linked yet."),
      );
    }
  } else if (benchmarks.length === 0) {
    marketGaps.push(dossierGap("pink_sheet", "Pink Sheet adapter pending"));
  }
  if (marketItems.length > 0) {
    marketGaps.push(dossierGap("freight_curve", "freight curve pending"));
    marketGaps.push(dossierGap("quality_adjustment", "quality adjustment pending"));
    marketGaps.push(dossierGap("landed_margin", "landed margin pending"));
  }
  if (entityType === "asset" && marketPressure.length === 0 && marketItems.length > 0) {
    marketGaps.push(
      dossierGap("buyer_pressure", "buyer pressure pending", "Import-dependency buyer pressure is not linked yet."),
    );
  }

  const limitations = [
    ...bundleLimitations,
    ...(linked?.limitations ?? []),
    ...(opportunities.flatMap((item) => item.limitations ?? [])),
    ...(paths.flatMap((item) => item.limitations ?? [])),
  ].filter((line, idx, arr) => arr.indexOf(line) === idx);

  const riskNotes: string[] = [];
  if (entityType === "vessel" && cargo.length > 0) {
    const inferredCargo = cargo.some(
      (item) => normalizeEvidenceLabel(item.evidence_label) !== "source-backed",
    );
    if (inferredCargo) riskNotes.push("Cargo quantity or product family remains inferred, not source-confirmed.");
  }
  if (entityType === "vessel" && sts.length === 0) {
    riskNotes.push("No STS prediction or event is linked; do not assume transshipment intent.");
  }
  if (entityType === "vessel" && !ownerItem) {
    riskNotes.push("Vessel owner/operator identity is weak or missing; verify before outreach.");
  }
  if (cargo.some((item) => item.route_hint?.latest_destination)) {
    riskNotes.push("AIS destination hints can be stale; confirm latest movement before acting.");
  }
  if (ownership.length === 0 && entityType !== "company") {
    riskNotes.push("Ownership chain or registry checks are not attached yet.");
  }
  if (opportunities.some((item) => normalizeEvidenceLabel(item.evidence_grade) !== "source-backed")) {
    riskNotes.push("Scored lane opportunities are indicative only; verify counterparties before outreach.");
  }
  if (entityType === "asset" && marketItems.length === 0) {
    riskNotes.push("No benchmark or market-pressure context is linked; margin views remain pending.");
  }
  if (entityType === "company" && assets.length === 0 && cargo.length === 0) {
    riskNotes.push("No operated/owned assets or vessel involvement is linked to this company yet.");
  }
  riskNotes.push("Every inferred opportunity should be verified before outreach.");

  const riskItems: DossierSectionItem[] = [
    ...limitations.map((line, idx) => ({
      id: `limitation-${idx}`,
      evidenceLabel: "reported",
      title: "limitation",
      lines: [line],
    })),
    ...riskNotes.map((line, idx) => ({
      id: `risk-note-${idx}`,
      evidenceLabel: "inferred",
      title: "risk note",
      lines: [line],
    })),
  ];

  const companyAssetItems = entityType === "company" ? assets.map(dossierAssetItem) : [];
  const supplierTabItems =
    entityType === "company"
      ? [...supplierItems, ...companyAssetItems]
      : supplierItems;

  const tabs: DossierWorkspaceView["tabs"] = {
    chain: { count: chainItems.length, items: chainItems, gaps: chainGaps },
    cargo: { count: cargoItems.length, items: cargoItems, gaps: cargoGaps },
    buyers: { count: buyerItems.length, items: buyerItems, gaps: buyerGaps },
    suppliers: { count: supplierTabItems.length, items: supplierTabItems, gaps: supplierGaps },
    ownership: { count: ownershipItems.length, items: ownershipItems, gaps: ownershipGaps },
    contacts: { count: contactItems.length, items: contactItems, gaps: contactGaps },
    market: { count: marketItems.length, items: marketItems, gaps: marketGaps },
    risk: { count: riskItems.length, items: riskItems, gaps: [] },
  };

  const evidenceCount = Object.values(tabs).reduce((sum, tab) => sum + tab.count, 0);

  return {
    entityType,
    entityName: profile?.name ?? linked?.entity_name,
    evidenceCount,
    tabs,
    riskNotes,
    limitations,
  };
}

export async function fetchShipvaultCompany(companyId: string): Promise<ShipvaultCompany | null> {
  const res = await fetch(`${API_BASE}/api/energy/shipvault/companies/${encodeURIComponent(companyId)}`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<ShipvaultCompany>;
}

export async function fetchVesselPortCalls(mmsi: string, limit = 20): Promise<PortCallRecord[]> {
  const res = await fetch(
    `${API_BASE}/api/energy/vessels/by-mmsi/${encodeURIComponent(mmsi)}/port-calls?limit=${limit}`,
    authFetchOpts,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { port_calls?: PortCallRecord[] };
  return data.port_calls ?? [];
}

export async function fetchVesselTrack(mmsi: string, hours = 24): Promise<FeatureCollection> {
  const res = await fetch(
    `${API_BASE}/api/energy/vessels/by-mmsi/${encodeURIComponent(mmsi)}/track?hours=${hours}`,
    authFetchOpts,
  );
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection>;
}

export async function fetchSTSEvents(bbox?: string): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : "";
  const res = await fetch(`${API_BASE}/api/energy/sts/events${q}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type STSSummary = {
  events_24h?: number;
  events_7d?: number;
  events_total?: number;
  events_unscored?: number;
  predictions_active?: number;
  last_observed_at?: string | null;
};

export async function fetchSTSSummary(): Promise<STSSummary | null> {
  const res = await fetch(`${API_BASE}/api/energy/sts/summary`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<STSSummary>;
}

export async function fetchSTSPredictions(
  bbox?: string,
  horizon = 24,
): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ horizon: String(horizon) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/sts/predictions?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type NearestGemPipelineHit = {
  found: boolean;
  segment_key?: string;
  project_id?: string;
  distance_m?: number;
  distance_km?: number;
  tags?: Record<string, unknown>;
  source_id?: string;
  attribution?: string;
  asset_id?: string;
};

export async function fetchNearestGemPipeline(
  lat: number,
  lng: number,
  maxM = 2000,
): Promise<NearestGemPipelineHit> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    max_m: String(maxM),
  });
  const res = await fetch(`${API_BASE}/api/energy/pipelines/nearest-gem?${params}`, authFetchOpts);
  if (!res.ok) return { found: false };
  return (await res.json()) as NearestGemPipelineHit;
}

export type PipelineSnappedAsset = {
  id: string;
  name: string;
  asset_type: string;
  distance_m?: number;
  confidence_score?: number;
  tier?: string;
};

export type PipelineConnectivity = {
  pipeline_id: string;
  osm_id?: string;
  legacy_id?: string;
  name?: string;
  tier?: string;
  method?: string;
  endpoints: {
    start: {
      point: { latitude: number; longitude: number };
      snapped_asset?: PipelineSnappedAsset;
    };
    end: {
      point: { latitude: number; longitude: number };
      snapped_asset?: PipelineSnappedAsset;
    };
  };
  upstream?: unknown[];
  downstream?: unknown[];
  limitations?: string[];
};

export async function fetchPipelineConnectivity(pipelineId: string): Promise<PipelineConnectivity | null> {
  const res = await fetch(
    `${API_BASE}/api/energy/pipelines/${encodeURIComponent(pipelineId)}/connectivity`,
    authFetchOpts,
  );
  if (!res.ok) return null;
  return (await res.json()) as PipelineConnectivity;
}

export type PipelineMapFocus = {
  osmId?: string;
  legacyRowId?: string;
  assetId?: string;
  connectedAssetIds: string[];
  overlay: FeatureCollection;
} | null;

export function pipelineFocusFromSelection(selection?: {
  _layer?: string;
  osm_id?: string;
  legacy_row_id?: string;
  id?: string;
} | null): PipelineMapFocus {
  if (!selection || selection._layer !== "pipelines") return null;
  const osmId = selection.osm_id ? String(selection.osm_id) : undefined;
  const legacyRowId = selection.legacy_row_id ? String(selection.legacy_row_id) : undefined;
  const assetId = selection.id ? String(selection.id) : undefined;
  if (!osmId && !legacyRowId && !assetId) return null;
  return {
    osmId,
    legacyRowId,
    assetId,
    connectedAssetIds: [],
    overlay: { type: "FeatureCollection", features: [] },
  };
}

export function buildPipelineMapFocus(
  conn: PipelineConnectivity,
  selection?: { osm_id?: string; legacy_row_id?: string; id?: string },
): PipelineMapFocus {
  const connectedAssetIds: string[] = [];
  const features: FeatureCollection["features"] = [];
  for (const [label, ep] of [
    ["Start", conn.endpoints?.start],
    ["End", conn.endpoints?.end],
  ] as const) {
    if (!ep?.point) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ep.point.longitude, ep.point.latitude] },
      properties: { kind: "endpoint", label },
    });
    if (ep.snapped_asset?.id) {
      connectedAssetIds.push(ep.snapped_asset.id);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [ep.point.longitude, ep.point.latitude] },
        properties: {
          kind: "facility",
          label: ep.snapped_asset.name,
          asset_type: ep.snapped_asset.asset_type,
          asset_id: ep.snapped_asset.id,
        },
      });
    }
  }
  return {
    osmId: selection?.osm_id ?? conn.osm_id,
    legacyRowId: selection?.legacy_row_id ?? conn.legacy_id,
    assetId: selection?.id,
    connectedAssetIds,
    overlay: { type: "FeatureCollection", features },
  };
}

/** Keep map-click ids when connectivity enrichment arrives (or fails). */
export function mergePipelineFocus(
  base: PipelineMapFocus,
  fromConnectivity: PipelineMapFocus | null | undefined,
): PipelineMapFocus {
  if (!base) return fromConnectivity ?? null;
  if (!fromConnectivity) return base;
  return {
    osmId: base.osmId ?? fromConnectivity.osmId,
    legacyRowId: base.legacyRowId ?? fromConnectivity.legacyRowId,
    assetId: base.assetId ?? fromConnectivity.assetId,
    connectedAssetIds: fromConnectivity.connectedAssetIds,
    overlay:
      fromConnectivity.overlay.features.length > 0 ? fromConnectivity.overlay : base.overlay,
  };
}

export async function fetchBunkerSuppliers(): Promise<{
  hubs: Array<{
    hub_key: string;
    port_name: string;
    locode?: string;
    country_code?: string;
    license_authority?: string;
    register_tier?: string;
    suppliers: Array<{
      id: string;
      name: string;
      phone?: string;
      email?: string;
      products?: string[];
      fuels_supplied?: string;
      source_url?: string;
      confidence_score?: number;
    }>;
  }>;
  supplier_count?: number;
  disclaimer?: string;
}> {
  const res = await fetch(`${API_BASE}/api/energy/bunker/suppliers`, authFetchOpts);
  if (!res.ok) return { hubs: [] };
  return res.json();
}

export async function fetchStorageSites(bbox?: string): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ limit: "1500" });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/storage/sites?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export type StorageSummary = {
  sites?: number;
  tanks?: number;
  inventory_bbl_low?: number;
  inventory_bbl_high?: number;
  us_crude_stock_trend?: {
    latest_kbbl?: number;
    period?: string;
    direction?: string;
    weekly_delta_kbbl?: number;
  };
};

export async function fetchStorageSummary(): Promise<StorageSummary | null> {
  const res = await fetch(`${API_BASE}/api/energy/storage/summary`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<StorageSummary>;
}

export async function fetchMCRCorridors(bbox?: string, limit = 300): Promise<FeatureCollection & { disclaimer?: string; tier?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/energy/mcr/corridors?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { disclaimer?: string; tier?: string }>;
}

export async function fetchAssetGeometries(
  bbox?: string,
  limit = 500,
): Promise<FeatureCollection & { count?: number; simplified?: boolean; message?: string }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bbox) params.set("bbox", bbox);
  const res = await fetch(`${API_BASE}/api/intel/asset-geometries?${params}`, authFetchOpts);
  if (!res.ok) {
    return { type: "FeatureCollection", features: [] };
  }
  return res.json() as Promise<FeatureCollection & { count?: number; simplified?: boolean; message?: string }>;
}

export async function fetchUnknownSupplierLeads(limit = 12): Promise<UnknownSupplierLead[]> {
  const res = await fetch(`${API_BASE}/api/energy/leads/unknown-suppliers?limit=${limit}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { leads?: UnknownSupplierLead[] };
  return data.leads ?? [];
}

export async function fetchMCRStatus(): Promise<MCRScaffoldStatus | null> {
  const res = await fetch(`${API_BASE}/api/energy/mcr/scaffold/status`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<MCRScaffoldStatus>;
}

export async function fetchIntelOpportunities(params?: {
  commodity?: string;
  origin?: string;
  destination?: string;
  minScore?: number;
  role?: string;
  limit?: number;
}): Promise<IntelOpportunity[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 25) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.destination) q.set("destination", params.destination);
  if (params?.minScore != null) q.set("min_score", String(params.minScore));
  if (params?.role) q.set("role", params.role);
  const res = await fetch(`${API_BASE}/api/intel/opportunities?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelOpportunity[] };
  return data.items ?? [];
}

export async function fetchIntelCargoMovements(params?: {
  commodity?: string;
  country?: string;
  limit?: number;
}): Promise<IntelCargoMovement[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.country) q.set("country", params.country);
  const res = await fetch(`${API_BASE}/api/intel/cargo-movements?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelCargoMovement[] };
  return data.items ?? [];
}

export async function fetchIntelSTSPredictions(limit = 12): Promise<IntelSTSPrediction[]> {
  const res = await fetch(`${API_BASE}/api/intel/sts-predictions?limit=${limit}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelSTSPrediction[] };
  return data.items ?? [];
}

export async function fetchIntelImporters(params?: {
  commodity?: string;
  origin?: string;
  company?: string;
  limit?: number;
}): Promise<IntelImporter[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.company) q.set("company", params.company);
  const res = await fetch(`${API_BASE}/api/intel/importers?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelImporter[] };
  return data.items ?? [];
}

export async function fetchIntelInvestorPaths(params?: {
  commodity?: string;
  origin?: string;
  destination?: string;
  investor?: string;
  assetId?: string;
  opportunityId?: string;
  minScore?: number;
  limit?: number;
}): Promise<IntelInvestorPath[]> {
  const q = new URLSearchParams({ limit: String(params?.limit ?? 12) });
  if (params?.commodity) q.set("commodity", params.commodity);
  if (params?.origin) q.set("origin", params.origin);
  if (params?.destination) q.set("destination", params.destination);
  if (params?.investor) q.set("investor", params.investor);
  if (params?.assetId) q.set("asset_id", params.assetId);
  if (params?.opportunityId) q.set("opportunity_id", params.opportunityId);
  if (params?.minScore != null) q.set("min_score", String(params.minScore));
  const res = await fetch(`${API_BASE}/api/intel/investor-paths?${q}`, authFetchOpts);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: IntelInvestorPath[] };
  return data.items ?? [];
}

export async function fetchIntelCommercialProfile(
  entityType: "asset" | "company" | "vessel" | string,
  id: string,
): Promise<IntelCommercialProfile | null> {
  const res = await fetch(
    `${API_BASE}/api/intel/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/commercial-profile`,
    authFetchOpts,
  );
  if (!res.ok) return null;
  return res.json() as Promise<IntelCommercialProfile>;
}

export async function fetchIntelArbitrage(params: {
  origin?: string;
  destination?: string;
  commodity?: string;
}): Promise<IntelArbitrage | null> {
  const q = new URLSearchParams();
  if (params.origin) q.set("origin", params.origin);
  if (params.destination) q.set("destination", params.destination);
  if (params.commodity) q.set("commodity", params.commodity);
  const res = await fetch(`${API_BASE}/api/intel/arbitrage?${q}`, authFetchOpts);
  if (!res.ok) return null;
  return res.json() as Promise<IntelArbitrage>;
}
