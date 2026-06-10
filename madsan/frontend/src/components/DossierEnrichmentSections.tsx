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

export function VesselOwnershipSection({ dossier }: Props) {
  if (dossier.entity_type !== "vessel") return null;

  const block = resolveVesselEnrichment(dossier);
  const summary = dossier.summary ?? {};
  const flag = block?.flag ?? (summary.flag != null ? String(summary.flag) : undefined);
  const dwt =
    block?.deadweight_tons ??
    (summary.deadweight_tons != null ? Number(summary.deadweight_tons) : undefined) ??
    (summary.dwt != null ? Number(summary.dwt) : undefined);

  const hasUuid = /^[0-9a-f-]{36}$/i.test(dossier.id);
  const rows: Array<{ label: string; value: string }> = [];
  if (block?.owner) rows.push({ label: "owner", value: block.owner });
  if (block?.operator) rows.push({ label: "operator", value: block.operator });
  if (flag) rows.push({ label: "flag", value: flag });
  if (dwt != null && Number.isFinite(dwt)) rows.push({ label: "DWT", value: dwt.toLocaleString() });

  const hasContent = rows.length > 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <EnrichmentHeader
        title="Ownership"
        block={block}
        showRefresh={hasUuid}
        entityType="vessel"
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
            No owner or operator on file for this vessel.
          </p>
          <EnrichmentMeta block={block} />
          <EnrichmentLimitations block={block} />
        </>
      ) : (
        <p className="disclaimer" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Registry owner and operator are not on file for this vessel. AIS identity fields (name, IMO, MMSI) appear
          below. The scheduler refreshes from ShipVault cache and Equasis when a match exists.
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
