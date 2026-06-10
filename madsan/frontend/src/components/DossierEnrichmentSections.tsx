"use client";

import { useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import {
  type EnrichmentBlock,
  assetShowsEnrichment,
  enrichmentRefreshUrl,
  enrichmentTierBadgeClass,
  formatCapacity,
  formatEnrichmentTier,
  formatFetchedAt,
  formatProducts,
  isEnrichmentStale,
  type CoreDossier,
  resolveAssetEnrichment,
  resolveVesselEnrichment,
} from "@/lib/dossier";
import { API_BASE } from "@/lib/layers";

type Props = {
  dossier: CoreDossier;
};

function EnrichmentDl({ rows }: { rows: Array<{ label: string; value: string }> }) {
  if (!rows.length) return null;
  return (
    <dl
      style={{
        margin: "6px 0 0",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "4px 12px",
        color: "var(--muted)",
        fontSize: 12,
      }}
    >
      {rows.map((row) => (
        <span key={row.label} style={{ display: "contents" }}>
          <dt>{row.label}</dt>
          <dd style={{ margin: 0, color: "var(--text)" }}>{row.value}</dd>
        </span>
      ))}
    </dl>
  );
}

function EnrichmentHeader({
  title,
  block,
  showRefresh,
  entityType,
  entityId,
}: {
  title: string;
  block: EnrichmentBlock | null;
  showRefresh: boolean;
  entityType: string;
  entityId: string;
}) {
  const [refreshMsg, setRefreshMsg] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);

  async function requestRefresh() {
    setRefreshBusy(true);
    setRefreshMsg("");
    try {
      const res = await fetch(`${API_BASE}${enrichmentRefreshUrl(entityType, entityId)}`, {
        ...authFetchOpts,
        method: "POST",
      });
      if (res.status === 202) {
        setRefreshMsg("Refresh queued — enrichment updates in the background.");
        return;
      }
      if (res.status === 404 || res.status === 501) {
        setRefreshMsg("Background refresh is not available yet.");
        return;
      }
      const text = await res.text();
      setRefreshMsg(text || `Request failed (${res.status})`);
    } catch {
      setRefreshMsg("Could not reach enrichment refresh API.");
    } finally {
      setRefreshBusy(false);
    }
  }

  const tier = block?.tier ?? "not_available";
  const stale = block ? isEnrichmentStale(block) : false;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <strong>{title}</strong>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span
          className={`badge compact ${enrichmentTierBadgeClass(tier)}`}
          title={block?.source ? `Source: ${block.source}` : undefined}
        >
          {formatEnrichmentTier(tier)}
        </span>
        {showRefresh && (
          <button
            type="button"
            onClick={() => void requestRefresh()}
            disabled={refreshBusy}
            style={{
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: refreshBusy ? "wait" : "pointer",
            }}
          >
            {refreshBusy ? "Queuing…" : "Request refresh"}
          </button>
        )}
      </div>
      {stale && (
        <p className="disclaimer" style={{ margin: "4px 0 0", width: "100%", fontSize: 11 }}>
          Enrichment data is past its freshness window — values may be outdated.
        </p>
      )}
      {refreshMsg && (
        <p style={{ margin: "4px 0 0", width: "100%", fontSize: 11, color: "var(--warn)" }}>{refreshMsg}</p>
      )}
    </div>
  );
}

function EnrichmentMeta({ block }: { block: EnrichmentBlock }) {
  const fetched = formatFetchedAt(block.fetched_at);
  const parts: string[] = [];
  if (fetched) parts.push(`fetched ${fetched}`);
  if (block.source && block.source !== "—") parts.push(block.source);
  if (!parts.length) return null;
  return (
    <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--muted)" }}>
      {parts.join(" · ")}
    </p>
  );
}

function EnrichmentLimitations({ block }: { block: EnrichmentBlock }) {
  if (!block.limitations?.length) return null;
  return (
    <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 11 }}>
      {block.limitations[0]}
    </p>
  );
}

type NameHistoryEntry = {
  name?: string;
  from_date?: string;
  to_date?: string;
  disponent?: string;
};

function readNameHistory(summary: Record<string, unknown>): NameHistoryEntry[] {
  const raw = summary.name_history;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => e != null && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({
      name: e.name != null ? String(e.name) : undefined,
      from_date: e.from_date != null ? String(e.from_date) : undefined,
      to_date: e.to_date != null ? String(e.to_date) : undefined,
      disponent: e.disponent != null ? String(e.disponent) : undefined,
    }))
    .filter((e) => e.name);
}

function readOwnerProfile(summary: Record<string, unknown>): Record<string, unknown> | null {
  const raw = summary.owner_profile;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

export type VesselSpecs = {
  build_year?: number;
  vessel_class?: string;
  gross_tonnage?: number;
  deadweight_tons?: number;
  net_tonnage?: number;
  estimated_value_usd?: number;
  length_m?: number;
  beam_m?: number;
  depth_m?: number;
  draft_m?: number;
  propulsion?: string;
  engine_power_kw?: number;
  engine_power_hp?: number;
  capacity_grain?: number;
  capacity_bale?: number;
  capacity_teu?: number;
  vessel_status?: string;
  status?: string;
  builder?: string;
  yard_name?: string;
  yard_number?: string;
};

function numSpec(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function strSpec(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function readVesselSpecs(summary: Record<string, unknown>): VesselSpecs {
  const raw = summary.vessel_specs;
  const base: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const keys = [
    "build_year",
    "vessel_class",
    "gross_tonnage",
    "deadweight_tons",
    "net_tonnage",
    "estimated_value_usd",
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
    "builder",
    "yard_name",
    "yard_number",
    "vessel_status",
    "status",
  ] as const;
  for (const k of keys) {
    if (base[k] == null && summary[k] != null) base[k] = summary[k];
  }
  const yard = summary.yard;
  if (yard && typeof yard === "object" && !Array.isArray(yard)) {
    const y = yard as Record<string, unknown>;
    if (!base.yard_name) base.yard_name = y.name;
    if (!base.yard_number) base.yard_number = y.yard_number;
    if (!base.build_year && y.build_year != null) base.build_year = y.build_year;
  }
  return {
    build_year: numSpec(base.build_year),
    vessel_class: strSpec(base.vessel_class),
    gross_tonnage: numSpec(base.gross_tonnage),
    deadweight_tons: numSpec(base.deadweight_tons),
    net_tonnage: numSpec(base.net_tonnage),
    estimated_value_usd: numSpec(base.estimated_value_usd),
    length_m: numSpec(base.length_m),
    beam_m: numSpec(base.beam_m),
    depth_m: numSpec(base.depth_m),
    draft_m: numSpec(base.draft_m),
    propulsion: strSpec(base.propulsion),
    engine_power_kw: numSpec(base.engine_power_kw),
    engine_power_hp: numSpec(base.engine_power_hp),
    capacity_grain: numSpec(base.capacity_grain),
    capacity_bale: numSpec(base.capacity_bale),
    capacity_teu: numSpec(base.capacity_teu),
    vessel_status: strSpec(base.vessel_status) ?? strSpec(base.status),
    builder: strSpec(base.builder),
    yard_name: strSpec(base.yard_name),
    yard_number: strSpec(base.yard_number),
  };
}

function formatMeters(v?: number): string | undefined {
  if (v == null) return undefined;
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`;
}

function formatUsd(v?: number): string | undefined {
  if (v == null) return undefined;
  return `$${Math.round(v).toLocaleString()}`;
}

export function VesselSpecificationsSection({ dossier }: Props) {
  if (dossier.entity_type !== "vessel") return null;

  const summary = dossier.summary ?? {};
  const specs = readVesselSpecs(summary);
  const block = resolveVesselEnrichment(dossier);
  const status = specs.vessel_status;
  const rows: Array<{ label: string; value: string }> = [];

  if (specs.build_year != null) rows.push({ label: "built", value: String(specs.build_year) });
  if (specs.propulsion) rows.push({ label: "propulsion", value: specs.propulsion });
  if (specs.vessel_class) rows.push({ label: "class", value: specs.vessel_class });
  if (status) rows.push({ label: "status", value: status });
  if (specs.gross_tonnage != null) rows.push({ label: "GT", value: specs.gross_tonnage.toLocaleString() });
  if (specs.net_tonnage != null) rows.push({ label: "NT", value: specs.net_tonnage.toLocaleString() });
  const dwt =
    specs.deadweight_tons ??
    (summary.deadweight_tons != null ? Number(summary.deadweight_tons) : undefined) ??
    (summary.dwt != null ? Number(summary.dwt) : undefined);
  if (dwt != null && Number.isFinite(dwt)) rows.push({ label: "DWT", value: dwt.toLocaleString() });
  if (specs.estimated_value_usd != null) {
    const est = formatUsd(specs.estimated_value_usd);
    if (est) rows.push({ label: "est. value", value: est });
  }

  const loa = formatMeters(specs.length_m);
  const beam = formatMeters(specs.beam_m);
  const depth = formatMeters(specs.depth_m);
  const draft = formatMeters(specs.draft_m);
  if (loa) rows.push({ label: "LOA", value: loa });
  if (beam) rows.push({ label: "beam", value: beam });
  if (depth) rows.push({ label: "depth", value: depth });
  if (draft) rows.push({ label: "draft", value: draft });

  if (specs.capacity_grain != null) {
    rows.push({ label: "grain cap.", value: specs.capacity_grain.toLocaleString() });
  }
  if (specs.capacity_bale != null) {
    rows.push({ label: "bale cap.", value: specs.capacity_bale.toLocaleString() });
  }
  if (specs.capacity_teu != null) rows.push({ label: "TEU", value: specs.capacity_teu.toLocaleString() });

  const yardParts = [specs.builder, specs.yard_name, specs.yard_number ? `#${specs.yard_number}` : undefined]
    .filter(Boolean)
    .join(" · ");
  if (yardParts) rows.push({ label: "yard", value: yardParts });

  if (!rows.length) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <EnrichmentHeader title="Vessel specifications" block={block} showRefresh={false} entityType="vessel" entityId={dossier.id} />
      <EnrichmentDl rows={rows} />
    </div>
  );
}

export function VesselOwnershipSection({ dossier }: Props) {
  if (dossier.entity_type !== "vessel") return null;

  const block = resolveVesselEnrichment(dossier);
  const summary = dossier.summary ?? {};
  const flag = block?.flag ?? (summary.flag != null ? String(summary.flag) : undefined);
  const dwt =
    block?.deadweight_tons ??
    (summary.deadweight_tons != null ? Number(summary.deadweight_tons) : undefined) ??
    (summary.dwt != null ? Number(summary.dwt) : undefined);
  const nameHistory = readNameHistory(summary);
  const ownerProfile = readOwnerProfile(summary);
  const ownerCompanyId =
    ownerProfile?.madsan_company_id != null
      ? String(ownerProfile.madsan_company_id)
      : ownerProfile?.shipvault_company_id != null
        ? String(ownerProfile.shipvault_company_id)
        : undefined;
  const fleetSize =
    ownerProfile?.fleet_size != null && Number.isFinite(Number(ownerProfile.fleet_size))
      ? Number(ownerProfile.fleet_size)
      : undefined;

  const hasUuid = /^[0-9a-f-]{36}$/i.test(dossier.id);
  const rows: Array<{ label: string; value: string }> = [];
  if (block?.owner) rows.push({ label: "owner", value: block.owner });
  if (block?.operator) rows.push({ label: "operator", value: block.operator });
  if (flag) rows.push({ label: "flag", value: flag });
  if (dwt != null && Number.isFinite(dwt)) rows.push({ label: "DWT", value: dwt.toLocaleString() });
  if (fleetSize != null) rows.push({ label: "owner fleet", value: fleetSize.toLocaleString() });

  const hasContent = rows.length > 0 || nameHistory.length > 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <EnrichmentHeader
        title="Ownership"
        block={block}
        showRefresh={hasUuid}
        entityType="vessel"
        entityId={dossier.id}
      />
      {ownerCompanyId && ownerProfile?.madsan_company_id != null && (
        <p style={{ margin: "4px 0 0", fontSize: 11 }}>
          <a href={`/dossier/company/${ownerCompanyId}`} style={{ color: "var(--accent)" }}>
            View owner company dossier
          </a>
        </p>
      )}
      {nameHistory.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12 }}>Name history</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 11, color: "var(--muted)" }}>
            {nameHistory.map((entry, i) => (
              <li key={`${entry.name}-${i}`} style={{ marginBottom: 4 }}>
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{entry.name}</span>
                {(entry.from_date || entry.to_date) && (
                  <span> · {[entry.from_date, entry.to_date].filter(Boolean).join(" → ")}</span>
                )}
                {entry.disponent && <span> · {entry.disponent}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasContent ? (
        <>
          <EnrichmentDl rows={rows} />
          {block && <EnrichmentMeta block={block} />}
          {block && <EnrichmentLimitations block={block} />}
        </>
      ) : block ? (
        <>
          <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 12 }}>
            No owner or operator on file for this vessel.
          </p>
          <EnrichmentMeta block={block} />
          <EnrichmentLimitations block={block} />
        </>
      ) : (
        <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Registry owner and operator are not on file for this vessel. AIS identity fields (name, IMO, MMSI) appear
          below. The scheduler refreshes owner/operator from ShipVault when credentials are configured.
        </p>
      )}
    </div>
  );
}

export function AssetOperatorCapacitySection({ dossier }: Props) {
  if (dossier.entity_type !== "asset") return null;

  const assetType = String(dossier.summary?.asset_type ?? "");
  if (!assetShowsEnrichment(assetType)) return null;

  const block = resolveAssetEnrichment(dossier);
  const capacityStr = block ? formatCapacity(block) : undefined;
  const productsStr = block ? formatProducts(block.products) : undefined;

  const hasUuid = /^[0-9a-f-]{36}$/i.test(dossier.id);
  const rows: Array<{ label: string; value: string }> = [];
  if (block?.operator) rows.push({ label: "operator", value: block.operator });
  if (block?.owner) rows.push({ label: "owner", value: block.owner });
  if (productsStr) rows.push({ label: "products", value: productsStr });
  if (capacityStr) rows.push({ label: "capacity", value: capacityStr });

  const hasContent = rows.length > 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <EnrichmentHeader
        title="Operator & capacity"
        block={block}
        showRefresh={hasUuid}
        entityType="asset"
        entityId={dossier.id}
      />
      {hasContent ? (
        <>
          <EnrichmentDl rows={rows} />
          {block && <EnrichmentMeta block={block} />}
          {block && <EnrichmentLimitations block={block} />}
        </>
      ) : block ? (
        <>
          <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 12 }}>
            No operator or capacity on file — OSM tags may still appear in the summary above.
          </p>
          <EnrichmentMeta block={block} />
          <EnrichmentLimitations block={block} />
        </>
      ) : (
        <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Not enriched yet — scheduled background refresh reconciles OSM tags with curated terminal and capacity
          registries.
        </p>
      )}
    </div>
  );
}
