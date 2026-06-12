/** Precomputed enrichment on dossier responses — no live pull on mount. */

export type EnrichmentBlock = {
  owner?: string;
  operator?: string;
  flag?: string;
  deadweight_tons?: number;
  capacity?: number | string;
  capacity_unit?: string;
  products?: string[] | string;
  tier: string;
  source: string;
  fetched_at?: string;
  stale_after?: string;
  limitations?: string[];
  confidence?: number;
};

/** Raw vessel_enrichment from API (field names may vary until backend merge). */
export type VesselEnrichmentRaw = {
  owner_name?: string;
  owner?: string;
  operator_name?: string;
  operator?: string;
  flag?: string;
  flag_country_code?: string;
  deadweight_tons?: number;
  dwt?: number;
  gross_tonnage?: number;
  tier?: string;
  source?: string;
  fetched_at?: string;
  stale_after?: string;
  limitations?: string[] | string;
  confidence?: number;
};

/** Raw asset_enrichment from API (field names may vary until backend merge). */
export type AssetEnrichmentRaw = {
  operator_name?: string;
  operator?: string;
  owner_name?: string;
  owner?: string;
  capacity_value?: number;
  capacity?: number | string;
  capacity_unit?: string;
  products?: string[] | unknown;
  tier?: string;
  source?: string;
  fetched_at?: string;
  stale_after?: string;
  limitations?: string[] | string;
  confidence?: number;
};

export type CoreDossier = {
  id: string;
  entity_type: string;
  name: string;
  summary?: Record<string, unknown>;
  location?: Record<string, unknown>;
  confidence?: { score?: number; status?: string; last_verified_at?: string };
  opportunity_score?: number;
  limitations?: string[];
  vessel_enrichment?: VesselEnrichmentRaw | null;
  asset_enrichment?: AssetEnrichmentRaw | null;
  enrichment?: EnrichmentBlock | null;
};

const ASSET_ENRICHMENT_TYPES = new Set([
  "tank_farm",
  "refinery",
  "terminal",
  "storage",
  "tank",
  "pipeline",
]);

export function assetShowsEnrichment(assetType?: string): boolean {
  if (!assetType) return false;
  return ASSET_ENRICHMENT_TYPES.has(assetType.toLowerCase());
}

/** GEM pipeline fields rendered in dedicated dossier sections (hide from generic summary list). */
export const GEM_PIPELINE_PROFILE_KEYS = new Set([
  "parent_company",
  "fuel",
  "fuel_source",
  "status",
  "capacity_text",
  "length_km",
  "diameter",
  "diameter_units",
  "wiki_url",
  "gem_owner_entity_ids",
  "proposal_year",
  "construction_year",
  "start_years",
  "cancelled_year",
  "stop_year",
  "shelved_year",
  "delay_type",
  "delay_note",
  "start_location",
  "start_country",
  "start_sub_region",
  "start_region",
  "end_location",
  "end_country",
  "end_sub_region",
  "end_region",
  "cost",
  "language",
  "gem_last_updated",
  "data_source",
  "source_url",
  "segment_key",
  "project_id",
  "countries",
]);

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function limitationsList(v: string[] | string | undefined): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => str(x)).filter(Boolean) as string[];
    return out.length ? out : undefined;
  }
  const one = str(v);
  return one ? [one] : undefined;
}

function productsList(v: unknown): string[] | string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const out = v.map((x) => str(x)).filter(Boolean) as string[];
    return out.length ? out : undefined;
  }
  return str(v);
}

export function normalizeVesselEnrichment(raw?: VesselEnrichmentRaw | EnrichmentBlock | null): EnrichmentBlock | null {
  if (!raw) return null;
  const tier = str((raw as VesselEnrichmentRaw).tier) ?? "not_available";
  const source = str((raw as EnrichmentBlock).source) ?? "—";
  const block: EnrichmentBlock = {
    owner: str((raw as VesselEnrichmentRaw).owner_name) ?? str((raw as EnrichmentBlock).owner),
    operator: str((raw as VesselEnrichmentRaw).operator_name) ?? str((raw as EnrichmentBlock).operator),
    flag: str((raw as VesselEnrichmentRaw).flag) ?? str((raw as VesselEnrichmentRaw).flag_country_code) ?? str((raw as EnrichmentBlock).flag),
    deadweight_tons:
      num((raw as VesselEnrichmentRaw).deadweight_tons) ??
      num((raw as VesselEnrichmentRaw).dwt) ??
      num((raw as EnrichmentBlock).deadweight_tons),
    tier,
    source,
    fetched_at: str((raw as EnrichmentBlock).fetched_at),
    stale_after: str((raw as EnrichmentBlock).stale_after),
    limitations: limitationsList((raw as EnrichmentBlock).limitations),
    confidence: num((raw as EnrichmentBlock).confidence),
  };
  if (!block.owner && !block.operator && !block.flag && block.deadweight_tons == null && tier === "not_available") {
    return null;
  }
  return block;
}

export function normalizeAssetEnrichment(raw?: AssetEnrichmentRaw | EnrichmentBlock | null): EnrichmentBlock | null {
  if (!raw) return null;
  const tier = str((raw as AssetEnrichmentRaw).tier) ?? "not_available";
  const source = str((raw as AssetEnrichmentRaw).source) ?? "—";
  const block: EnrichmentBlock = {
    operator: str((raw as AssetEnrichmentRaw).operator_name) ?? str((raw as AssetEnrichmentRaw).operator) ?? str((raw as EnrichmentBlock).operator),
    owner: str((raw as AssetEnrichmentRaw).owner_name) ?? str((raw as AssetEnrichmentRaw).owner) ?? str((raw as EnrichmentBlock).owner),
    capacity:
      (raw as AssetEnrichmentRaw).capacity_value ??
      (raw as AssetEnrichmentRaw).capacity ??
      (raw as EnrichmentBlock).capacity,
    capacity_unit:
      str((raw as AssetEnrichmentRaw).capacity_unit) ?? str((raw as EnrichmentBlock).capacity_unit),
    products: productsList((raw as AssetEnrichmentRaw).products) ?? productsList((raw as EnrichmentBlock).products),
    tier,
    source,
    fetched_at: str((raw as EnrichmentBlock).fetched_at),
    stale_after: str((raw as EnrichmentBlock).stale_after),
    limitations: limitationsList((raw as EnrichmentBlock).limitations),
    confidence: num((raw as EnrichmentBlock).confidence),
  };
  if (
    !block.operator &&
    !block.owner &&
    block.capacity == null &&
    !block.products &&
    tier === "not_available"
  ) {
    return null;
  }
  return block;
}

function vesselEnrichmentFromSummary(summary: Record<string, unknown>): EnrichmentBlock | null {
  const rawEnrich = summary.enrichment;
  const base: VesselEnrichmentRaw = {};
  if (rawEnrich && typeof rawEnrich === "object" && !Array.isArray(rawEnrich)) {
    Object.assign(base, rawEnrich as VesselEnrichmentRaw);
  }
  if (summary.owner_name != null) base.owner_name = String(summary.owner_name);
  if (summary.operator_name != null) base.operator_name = String(summary.operator_name);
  if (summary.registry_flag != null) base.flag = String(summary.registry_flag);
  if (summary.deadweight_tons != null) base.deadweight_tons = Number(summary.deadweight_tons);
  if (summary.dwt != null) base.deadweight_tons = Number(summary.dwt);
  return normalizeVesselEnrichment(base);
}

export function resolveVesselEnrichment(dossier: CoreDossier): EnrichmentBlock | null {
  return (
    normalizeVesselEnrichment(dossier.vessel_enrichment) ??
    (dossier.enrichment?.tier ? normalizeVesselEnrichment(dossier.enrichment) : null) ??
    vesselEnrichmentFromSummary(dossier.summary ?? {})
  );
}

function assetEnrichmentFromSummary(summary: Record<string, unknown>): EnrichmentBlock | null {
  const rawEnrich = summary.enrichment;
  const base: AssetEnrichmentRaw = {};
  if (rawEnrich && typeof rawEnrich === "object" && !Array.isArray(rawEnrich)) {
    Object.assign(base, rawEnrich as AssetEnrichmentRaw);
  }
  if (summary.operator_name != null) base.operator_name = String(summary.operator_name);
  if (summary.operator != null) base.operator = String(summary.operator);
  if (summary.owner_name != null) base.owner_name = String(summary.owner_name);
  if (summary.owner != null) base.owner = String(summary.owner);
  if (summary.capacity_value != null) base.capacity_value = Number(summary.capacity_value);
  if (summary.capacity != null) base.capacity = summary.capacity as number | string;
  if (summary.capacity_unit != null) base.capacity_unit = String(summary.capacity_unit);
  if (summary.products != null) base.products = summary.products as string[] | string;
  return normalizeAssetEnrichment(base);
}

export function resolveAssetEnrichment(dossier: CoreDossier): EnrichmentBlock | null {
  return (
    normalizeAssetEnrichment(dossier.asset_enrichment) ??
    (dossier.enrichment?.tier ? normalizeAssetEnrichment(dossier.enrichment) : null) ??
    assetEnrichmentFromSummary(dossier.summary ?? {})
  );
}

export function enrichmentTierBadgeClass(tier?: string): string {
  const t = (tier ?? "").toLowerCase();
  if (t === "observed" || t === "verified") return "tier-high";
  if (t === "inferred" || t === "partial") return "tier-mid";
  if (t === "not_available" || t === "missing" || t === "none" || t === "") return "tier-none";
  return "tier-low";
}

export function formatEnrichmentTier(tier?: string): string {
  const t = (tier ?? "not_available").toLowerCase();
  if (t === "observed") return "Observed";
  if (t === "inferred") return "Inferred";
  if (t === "not_available" || t === "missing") return "Not available";
  return t.replace(/_/g, " ");
}

export function isEnrichmentStale(block: EnrichmentBlock): boolean {
  if (!block.stale_after) return false;
  const d = new Date(block.stale_after);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

export function formatCapacity(block: EnrichmentBlock): string | undefined {
  if (block.capacity == null || String(block.capacity).trim() === "") return undefined;
  const unit = block.capacity_unit?.trim();
  const val = typeof block.capacity === "number" ? block.capacity.toLocaleString() : String(block.capacity);
  return unit ? `${val} ${unit}` : val;
}

export function formatProducts(products?: string[] | string): string | undefined {
  if (products == null) return undefined;
  if (Array.isArray(products)) return products.length ? products.join(", ") : undefined;
  const s = String(products).trim();
  return s || undefined;
}

export function formatFetchedAt(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const SUMMARY_ENRICHMENT_META_KEYS = new Set([
  "enrichment",
  "owner_name",
  "operator_name",
  "owner_profile",
  "name_history",
  "registry_flag",
  "gross_tonnage",
  "vessel_class",
  "build_year",
  "builder",
  "deadweight_tons",
  "dwt",
  "net_tonnage",
  "estimated_value_usd",
  "vessel_status",
  "length_m",
  "beam_m",
  "depth_m",
  "draft_m",
  "propulsion",
  "engine_power_kw",
  "engine_power_hp",
  "capacity_grain",
  "capacity_bale",
  "capacity_teu",
  "yard",
  "yard_id",
  "yard_name",
  "yard_number",
  "disponent",
  "vessel_specs",
  "enrichment_source",
  "enrichment_tier",
  "enrichment_confidence",
]);

/** Hide summary keys duplicated in enrichment panel when enrichment has values. */
export function summaryKeyHiddenInEnrichment(
  key: string,
  enrichment: EnrichmentBlock | null,
  entityType: string,
): boolean {
  const k = key.toLowerCase();
  if (SUMMARY_ENRICHMENT_META_KEYS.has(k)) return true;
  if (!enrichment) return false;
  if (entityType === "vessel") {
    if (k === "flag" && enrichment.flag) return true;
    if ((k === "deadweight_tons" || k === "dwt") && enrichment.deadweight_tons != null) return true;
    if (k === "owner_name" && enrichment.owner) return true;
    if (k === "operator_name" && enrichment.operator) return true;
  }
  if (entityType === "asset") {
    if (GEM_PIPELINE_PROFILE_KEYS.has(k)) return true;
    if (k === "operator" && enrichment.operator) return true;
    if (k === "owner" && enrichment.owner) return true;
    if (k === "capacity" && enrichment.capacity != null) return true;
    if (k === "capacity_value" && enrichment.capacity != null) return true;
    if (k === "capacity_unit" && enrichment.capacity != null) return true;
    if (k === "products" && enrichment.products) return true;
    if (k === "fuel" && enrichment.products) return true;
  }
  return false;
}

export function formatSummaryValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function enrichmentRefreshUrl(entityType: string, id: string): string {
  return `/api/core/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/enrichment/refresh`;
}
