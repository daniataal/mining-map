import type { MapSelection } from "@/components/EntityDossierPanel";
import {
  formatProducts,
  resolveAssetEnrichment,
  resolveVesselEnrichment,
  type CoreDossier,
} from "@/lib/dossier";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DealPackPrefill = Record<string, string>;

const DEAL_PACK_QUERY_KEYS = [
  "commodity",
  "quantity",
  "quantity_unit",
  "location",
  "seller",
  "buyer",
  "incoterm",
  "price",
  "currency",
  "claimed_vessel_mmsi",
  "claimed_asset_id",
  "entity_id",
  "entity_type",
] as const;

function inferCommodity(
  entityType: string,
  summary: Record<string, unknown>,
  enrichmentProducts?: string,
  substance?: string,
  vertical: "energy" | "metals" = "energy",
): string | undefined {
  if (enrichmentProducts) return enrichmentProducts.split(",")[0]?.trim();
  if (substance) {
    const s = substance.toLowerCase();
    if (s.includes("oil") || s.includes("petroleum")) return "VLSFO";
    if (s.includes("gas")) return "LNG";
    return substance;
  }
  const assetType = String(summary.asset_type ?? "").toLowerCase();
  if (vertical === "metals") {
    if (assetType.includes("mine") || summary.commodity === "gold") return "Gold (AU)";
    if (assetType.includes("smelter") || assetType.includes("processing")) return "Copper cathode";
    return undefined;
  }
  if (assetType.includes("refinery")) return "Brent crude";
  if (assetType.includes("lng")) return "LNG";
  if (assetType.includes("bunker")) return "VLSFO";
  if (assetType.includes("terminal") || assetType.includes("tank")) return "VLSFO";
  if (assetType.includes("pipeline")) return "VLSFO";
  const vesselClass = String(summary.vessel_class ?? summary.type ?? "").toLowerCase();
  if (entityType === "vessel" && (vesselClass.includes("tanker") || vesselClass.includes("oil"))) {
    return "VLSFO";
  }
  return undefined;
}

function inferLocation(
  dossier: CoreDossier | null,
  selection: MapSelection | null,
): string | undefined {
  const loc = dossier?.location ?? {};
  const country =
    (loc.country as string | undefined) ??
    (loc.country_code as string | undefined) ??
    (dossier?.summary?.country_code as string | undefined) ??
    selection?.country_code;
  const name = dossier?.name ?? selection?.name;
  if (name && country && !name.includes(country)) return `${name}, ${country}`;
  if (name) return name;
  if (country) return country;
  const lat = loc.latitude != null ? Number(loc.latitude) : NaN;
  const lng = loc.longitude != null ? Number(loc.longitude) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  }
  return undefined;
}

function inferSeller(
  dossier: CoreDossier | null,
  selection: MapSelection | null,
): string | undefined {
  const entityType = dossier?.entity_type ?? selection?._entityType ?? "asset";
  const summary = dossier?.summary ?? {};
  if (entityType === "company") return dossier?.name ?? selection?.name;
  if (entityType === "vessel") {
    const enrich = dossier ? resolveVesselEnrichment(dossier) : null;
    return enrich?.operator ?? enrich?.owner ?? dossier?.name ?? selection?.name;
  }
  const enrich = dossier ? resolveAssetEnrichment(dossier) : null;
  return (
    enrich?.operator ??
    enrich?.owner ??
    (summary.operator as string | undefined) ??
    (summary.operator_name as string | undefined) ??
    selection?.operator ??
    dossier?.name ??
    selection?.name
  );
}

/** Build deal form prefill from dossier and/or map selection. */
export function dealPackPrefillFromEntity(
  dossier: CoreDossier | null,
  selection: MapSelection | null,
  vertical: "energy" | "metals" = "energy",
): DealPackPrefill {
  const entityType = dossier?.entity_type ?? selection?._entityType ?? "asset";
  const summary = dossier?.summary ?? {};
  const enrichment =
    entityType === "vessel"
      ? dossier
        ? resolveVesselEnrichment(dossier)
        : null
      : dossier
        ? resolveAssetEnrichment(dossier)
        : null;
  const substance =
    (summary.substance as string | undefined) ??
    selection?.substance ??
    selection?.pipeline_substance;
  const prefill: DealPackPrefill = {};

  const seller = inferSeller(dossier, selection);
  if (seller) prefill.seller = seller;

  const location = inferLocation(dossier, selection);
  if (location) prefill.location = location;

  const commodity = inferCommodity(
    entityType,
    summary,
    enrichment ? formatProducts(enrichment.products) : undefined,
    substance,
    vertical,
  );
  if (commodity) prefill.commodity = commodity;

  if (vertical === "metals") {
    prefill.quantity_unit = prefill.quantity_unit ?? "kg";
  } else {
    prefill.quantity_unit = prefill.quantity_unit ?? "MT";
  }

  const entityId = dossier?.id ?? selection?.id;
  if (entityId && UUID_RE.test(entityId)) {
    prefill.entity_id = entityId;
    prefill.entity_type = entityType;
    if (entityType === "asset") prefill.claimed_asset_id = entityId;
  }

  const mmsi =
    (summary.mmsi != null ? String(summary.mmsi) : undefined) ?? selection?.mmsi;
  if (entityType === "vessel" && mmsi) prefill.claimed_vessel_mmsi = mmsi;

  return prefill;
}

/** Navigate URL for /deals with query params that pre-fill the verify form. */
export function buildDealPackHref(
  prefill: DealPackPrefill,
  vertical: "energy" | "metals" = "energy",
): string {
  const params = new URLSearchParams();
  if (vertical === "metals") params.set("vertical", "metals");
  params.set("from", "map");
  for (const key of DEAL_PACK_QUERY_KEYS) {
    const value = prefill[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/deals?${qs}` : "/deals";
}

/** Parse deal-pack query params from the current URL (client-only). */
export function parseDealPackSearchParams(search: string): {
  vertical: "energy" | "metals";
  prefill: DealPackPrefill;
  fromMap: boolean;
} {
  const params = new URLSearchParams(search);
  const prefill: DealPackPrefill = {};
  for (const key of DEAL_PACK_QUERY_KEYS) {
    const value = params.get(key);
    if (value) prefill[key] = value;
  }
  return {
    vertical: params.get("vertical") === "metals" ? "metals" : "energy",
    prefill,
    fromMap: params.get("from") === "map",
  };
}
