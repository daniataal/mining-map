"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  formatSummaryValue,
  isEnrichmentStale,
  type CoreDossier,
  resolveAssetEnrichment,
  resolveVesselEnrichment,
} from "@/lib/dossier";
import { apiBase } from "@/lib/layers";
import { cn } from "@/lib/utils";

type EnrichmentDossier = CoreDossier & {
  relationships?: Array<{
    id: string;
    type: string;
    entity_type: string;
    name: string;
    latitude?: number;
    longitude?: number;
  }>;
};

type Props = {
  dossier: EnrichmentDossier;
};

type NavigateEntityProps = {
  onNavigateEntity?: (
    selection: { id: string; name: string; _entityType: string },
    focus?: { lat: number; lng: number },
  ) => void;
};

function enrichmentBadgeVariant(tier: string): "verified" | "partial" | "destructive" | "muted" {
  const cls = enrichmentTierBadgeClass(tier);
  if (cls === "tier-high" || cls === "verified") return "verified";
  if (cls === "tier-mid" || cls === "partial") return "partial";
  if (cls === "tier-low") return "destructive";
  return "muted";
}

function EnrichmentDl({ rows }: { rows: Array<{ label: string; value: string; link?: () => void }> }) {
  if (!rows.length) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {rows.map((row) => (
        <span key={row.label} className="contents">
          <dt>{row.label}</dt>
          <dd className="m-0 text-foreground">
            {row.link ? (
              <button type="button" className="rel-link inline p-0 text-left" onClick={row.link}>
                {row.value}
              </button>
            ) : (
              row.value
            )}
          </dd>
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
      const res = await fetch(`${apiBase()}${enrichmentRefreshUrl(entityType, entityId)}`, {
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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <CardTitle className="text-sm">{title}</CardTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={enrichmentBadgeVariant(tier)} title={block?.source ? `Source: ${block.source}` : undefined}>
          {formatEnrichmentTier(tier)}
        </Badge>
        {showRefresh && (
          <button
            type="button"
            onClick={() => void requestRefresh()}
            disabled={refreshBusy}
            className={cn(
              "rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground",
              refreshBusy ? "cursor-wait opacity-60" : "cursor-pointer hover:border-brand-secondary hover:text-brand-secondary",
            )}
          >
            {refreshBusy ? "Queuing…" : "Request refresh"}
          </button>
        )}
      </div>
      {stale && (
        <p className="disclaimer m-0 w-full text-[11px]">
          Enrichment data is past its freshness window — values may be outdated.
        </p>
      )}
      {refreshMsg && (
        <p className="m-0 w-full text-[11px]" style={{ color: "var(--warn)" }}>{refreshMsg}</p>
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
  return <p className="mt-2 text-[11px] text-muted-foreground">{parts.join(" · ")}</p>;
}

function EnrichmentLimitations({ block }: { block: EnrichmentBlock }) {
  if (!block.limitations?.length) return null;
  return <p className="disclaimer mt-2 text-[11px]">{block.limitations[0]}</p>;
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

type OwnershipIntelEntry = {
  role?: string;
  label?: string;
  status?: string;
  detail?: string;
  weight?: number;
};

type OwnershipHistoryCandidate = {
  vessel_name?: string;
  disponent?: string;
  from_date?: string;
  to_date?: string;
  role?: string;
  status?: string;
  detail?: string;
};

type OwnershipRegistryCheck = {
  name?: string;
  purpose?: string;
  query?: string;
  status?: string;
};

type OwnershipIntel = {
  tier?: string;
  score?: number;
  summary?: string;
  beneficial_owner_status?: string;
  previous_ownership_status?: string;
  role_chain: OwnershipIntelEntry[];
  evidence: OwnershipIntelEntry[];
  history_candidates: OwnershipHistoryCandidate[];
  registry_checks: OwnershipRegistryCheck[];
  search_pivots: string[];
  limitations: string[];
};

type CommercialContact = {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  evidence?: string;
  confidence_score?: number;
  verification_status?: string;
};

type CommercialContactBundle = {
  role?: string;
  company_id?: string;
  name?: string;
  country_code?: string;
  website?: string;
  source_url?: string;
  register_source_url?: string;
  phone?: string;
  email?: string;
  parent_name?: string;
  parent_company_id?: string;
  shipvault_company_id?: string;
  shipvault_country?: string;
  shipvault_city?: string;
  source?: string;
  tier?: string;
  contacts: CommercialContact[];
};

function recordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is Record<string, unknown> => e != null && typeof e === "object" && !Array.isArray(e));
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);
}

function readOwnershipIntel(summary: Record<string, unknown>): OwnershipIntel | null {
  const raw = summary.ownership_intel;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  return {
    tier: strSpec(obj.tier),
    score: numSpec(obj.score),
    summary: strSpec(obj.summary),
    beneficial_owner_status: strSpec(obj.beneficial_owner_status),
    previous_ownership_status: strSpec(obj.previous_ownership_status),
    role_chain: recordArray(obj.role_chain).map((e) => ({
      role: strSpec(e.role),
      label: strSpec(e.label),
      status: strSpec(e.status),
    })),
    evidence: recordArray(obj.evidence).map((e) => ({
      role: strSpec(e.key),
      label: strSpec(e.label),
      status: strSpec(e.status),
      detail: strSpec(e.detail),
      weight: numSpec(e.weight),
    })),
    history_candidates: recordArray(obj.history_candidates).map((e) => ({
      vessel_name: strSpec(e.vessel_name),
      disponent: strSpec(e.disponent),
      from_date: strSpec(e.from_date),
      to_date: strSpec(e.to_date),
      role: strSpec(e.role),
      status: strSpec(e.status),
      detail: strSpec(e.detail),
    })),
    registry_checks: recordArray(obj.registry_checks).map((e) => ({
      name: strSpec(e.name),
      purpose: strSpec(e.purpose),
      query: strSpec(e.query),
      status: strSpec(e.status),
    })),
    search_pivots: stringArray(obj.search_pivots),
    limitations: stringArray(obj.limitations),
  };
}

function readCommercialContacts(summary: Record<string, unknown>): CommercialContactBundle[] {
  return recordArray(summary.commercial_contacts).map((bundle) => ({
    role: strSpec(bundle.role),
    company_id: strSpec(bundle.company_id),
    name: strSpec(bundle.name),
    country_code: strSpec(bundle.country_code),
    website: strSpec(bundle.website),
    source_url: strSpec(bundle.source_url),
    register_source_url: strSpec(bundle.register_source_url),
    phone: strSpec(bundle.phone),
    email: strSpec(bundle.email),
    parent_name: strSpec(bundle.parent_name),
    parent_company_id: strSpec(bundle.parent_company_id),
    shipvault_company_id: strSpec(bundle.shipvault_company_id),
    shipvault_country: strSpec(bundle.shipvault_country),
    shipvault_city: strSpec(bundle.shipvault_city),
    source: strSpec(bundle.source),
    tier: strSpec(bundle.tier),
    contacts: recordArray(bundle.contacts).map((contact) => ({
      name: strSpec(contact.name),
      email: strSpec(contact.email),
      phone: strSpec(contact.phone),
      role: strSpec(contact.role),
      evidence: strSpec(contact.evidence),
      confidence_score: numSpec(contact.confidence_score),
      verification_status: strSpec(contact.verification_status),
    })),
  })).filter((bundle) => bundle.name || bundle.email || bundle.phone || bundle.website || bundle.source_url || bundle.parent_name || bundle.contacts.length);
}

function ownershipTierBadgeVariant(tier?: string): "verified" | "partial" | "destructive" | "muted" {
  if (tier === "high") return "verified";
  if (tier === "medium") return "partial";
  if (tier === "low") return "destructive";
  return "muted";
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
    <Card size="sm" className="mb-3">
      <CardHeader>
        <EnrichmentHeader title="Vessel specifications" block={block} showRefresh={false} entityType="vessel" entityId={dossier.id} />
      </CardHeader>
      <CardContent>
        <EnrichmentDl rows={rows} />
      </CardContent>
    </Card>
  );
}

function OwnershipIntelPanel({ intel }: { intel: OwnershipIntel }) {
  const evidence = intel.evidence.slice(0, 5);
  const chain = intel.role_chain.filter((entry) => entry.label).slice(0, 5);
  const historyCandidates = intel.history_candidates.slice(0, 4);
  const registryChecks = intel.registry_checks.slice(0, 4);
  const pivots = intel.search_pivots.slice(0, 4);
  const limitation = intel.limitations[0];

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs">Owner-chain OSINT</strong>
        <div className="flex items-center gap-2">
          {intel.score != null && <span className="text-[11px] text-muted-foreground">{Math.round(intel.score)}/100</span>}
          <Badge variant={ownershipTierBadgeVariant(intel.tier)}>{intel.tier ?? "unknown"}</Badge>
        </div>
      </div>
      {intel.summary && <p className="mt-1.5 text-[11px] text-muted-foreground">{intel.summary}</p>}
      {chain.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
          {chain.map((entry, i) => (
            <span key={`${entry.role}-${entry.label}-${i}`} className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
              <span className="text-foreground">{entry.label}</span>
              {entry.status && <span> · {entry.status}</span>}
            </span>
          ))}
        </div>
      )}
      {evidence.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-[11px] text-muted-foreground">
          {evidence.map((entry, i) => (
            <li key={`${entry.role}-${i}`} className="mb-1">
              <span className="font-semibold text-foreground">{entry.label}</span>
              {entry.detail && <span> · {entry.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {historyCandidates.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <strong className="text-[11px]">Previous owner/operator clues</strong>
          <ul className="mt-1.5 list-disc pl-4 text-[11px] text-muted-foreground">
            {historyCandidates.map((entry, i) => (
              <li key={`${entry.vessel_name}-${entry.disponent}-${i}`} className="mb-1">
                <span className="font-semibold text-foreground">{entry.disponent}</span>
                {entry.vessel_name && <span> · {entry.vessel_name}</span>}
                {(entry.from_date || entry.to_date) && (
                  <span> · {[entry.from_date, entry.to_date].filter(Boolean).join(" → ")}</span>
                )}
                {entry.status && <span> · {entry.status}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {registryChecks.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <strong className="text-[11px]">Registry checks</strong>
          <ul className="mt-1.5 list-disc pl-4 text-[11px] text-muted-foreground">
            {registryChecks.map((check, i) => (
              <li key={`${check.name}-${i}`} className="mb-1">
                <span className="font-semibold text-foreground">{check.name}</span>
                {check.query && <span> · {check.query}</span>}
                {check.purpose && <span> · {check.purpose}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pivots.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <strong className="text-[11px]">Verification pivots</strong>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {pivots.map((pivot) => (
              <span key={pivot} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {pivot}
              </span>
            ))}
          </div>
        </div>
      )}
      {limitation && <p className="disclaimer mt-2 text-[11px]">{limitation}</p>}
    </div>
  );
}

function CommercialContactsPanel({ bundles }: { bundles: CommercialContactBundle[] }) {
  if (!bundles.length) return null;
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/20 p-2">
      <strong className="text-xs">Contacts & company chain</strong>
      <div className="mt-2 space-y-2">
        {bundles.map((bundle) => (
          <div key={`${bundle.role}-${bundle.company_id ?? bundle.name}`} className="rounded border border-border px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">{bundle.name ?? "Company"}</span>
              <span className="text-[10px] text-muted-foreground">{(bundle.role ?? "company").replace(/_/g, " ")}</span>
            </div>
            {(bundle.parent_name || bundle.shipvault_company_id || bundle.shipvault_country || bundle.shipvault_city) && (
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                {bundle.parent_name && <span>parent: {bundle.parent_name}</span>}
                {bundle.shipvault_company_id && <span>ShipVault {bundle.shipvault_company_id}</span>}
                {bundle.shipvault_city && <span>{bundle.shipvault_city}</span>}
                {bundle.shipvault_country && <span>{bundle.shipvault_country}</span>}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              {bundle.country_code && <span>{bundle.country_code}</span>}
              {bundle.website && (
                <a href={bundle.website} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  website
                </a>
              )}
              {bundle.register_source_url && (
                <a href={bundle.register_source_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  register
                </a>
              )}
              {!bundle.register_source_url && bundle.source_url && (
                <a href={bundle.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  source
                </a>
              )}
              {bundle.email && <a href={`mailto:${bundle.email}`}>{bundle.email}</a>}
              {bundle.phone && <a href={`tel:${bundle.phone}`}>{bundle.phone}</a>}
            </div>
            {bundle.contacts.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 text-[11px] text-muted-foreground">
                {bundle.contacts.slice(0, 4).map((contact, i) => (
                  <li key={`${contact.email}-${contact.phone}-${i}`} className="mb-1">
                    <span className="text-foreground">{contact.name || contact.role || "Contact"}</span>
                    {contact.role && contact.name && <span> · {contact.role}</span>}
                    {contact.email && <span> · {contact.email}</span>}
                    {contact.phone && <span> · {contact.phone}</span>}
                    {!contact.email && !contact.phone && contact.evidence && <span> · {contact.evidence}</span>}
                    {contact.verification_status && <span> · {contact.verification_status}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
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
  const ownershipIntel = readOwnershipIntel(summary);
  const commercialContacts = readCommercialContacts(summary);
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

  const hasContent = rows.length > 0 || nameHistory.length > 0 || ownershipIntel != null || commercialContacts.length > 0;

  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <EnrichmentHeader
          title="Ownership"
          block={block}
          showRefresh={hasUuid}
          entityType="vessel"
          entityId={dossier.id}
        />
      </CardHeader>
      <CardContent>
        {ownerCompanyId && ownerProfile?.madsan_company_id != null && (
          <p className="mt-0 text-[11px]">
            <a href={`/dossier/company/${ownerCompanyId}`} style={{ color: "var(--accent)" }}>
              View owner company dossier
            </a>
          </p>
        )}
        {ownershipIntel && <OwnershipIntelPanel intel={ownershipIntel} />}
        <CommercialContactsPanel bundles={commercialContacts} />
        {nameHistory.length > 0 && (
          <div className="mt-2">
            <strong className="text-xs">Name history</strong>
            <ul className="mt-1.5 list-disc pl-4 text-[11px] text-muted-foreground">
              {nameHistory.map((entry, i) => (
                <li key={`${entry.name}-${i}`} className="mb-1">
                  <span className="font-semibold text-foreground">{entry.name}</span>
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
            <p className="disclaimer mt-0 text-xs">No owner or operator on file for this vessel.</p>
            <EnrichmentMeta block={block} />
            <EnrichmentLimitations block={block} />
          </>
        ) : (
          <p className="disclaimer mt-0 text-xs">
            Registry owner and operator are not on file for this vessel. AIS identity fields (name, IMO, MMSI) appear
            below. The scheduler refreshes owner/operator from ShipVault when credentials are configured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AssetOperatorCapacitySection({
  dossier,
  onNavigateEntity,
}: Props & NavigateEntityProps) {
  if (dossier.entity_type !== "asset") return null;

  const assetType = String(dossier.summary?.asset_type ?? "");
  if (!assetShowsEnrichment(assetType)) return null;

  const isPipeline = assetType.toLowerCase() === "pipeline";
  const summary = dossier.summary ?? {};
  const block = resolveAssetEnrichment(dossier);
  const capacityStr =
    block ? formatCapacity(block) : formatSummaryValue(summary.capacity_text) ?? undefined;
  const productsStr =
    block ? formatProducts(block.products) : formatSummaryValue(summary.fuel) ?? undefined;

  const hasUuid = /^[0-9a-f-]{36}$/i.test(dossier.id);
  const ownerRel = dossier.relationships?.find(
    (r) => r.entity_type === "company" && (r.type === "owned_by" || r.type === "operated_by"),
  );
  const ownerLabel = block?.owner ?? (summary.owner ? String(summary.owner) : undefined);

  const rows: Array<{ label: string; value: string; link?: () => void }> = [];
  if (ownerLabel) {
    if (ownerRel && onNavigateEntity) {
      rows.push({
        label: "owner",
        value: ownerLabel,
        link: () => {
          const focus =
            ownerRel.latitude != null && ownerRel.longitude != null
              ? { lat: ownerRel.latitude, lng: ownerRel.longitude }
              : undefined;
          onNavigateEntity({ id: ownerRel.id, name: ownerRel.name, _entityType: "company" }, focus);
        },
      });
    } else {
      rows.push({ label: "owner", value: ownerLabel });
    }
  }
  if (isPipeline && summary.parent_company) {
    const parentRel = dossier.relationships?.find(
      (r) => r.entity_type === "company" && r.type === "parent_company",
    );
    if (parentRel && onNavigateEntity) {
      rows.push({
        label: "parent company",
        value: String(summary.parent_company),
        link: () => {
          const focus =
            parentRel.latitude != null && parentRel.longitude != null
              ? { lat: parentRel.latitude, lng: parentRel.longitude }
              : undefined;
          onNavigateEntity({ id: parentRel.id, name: parentRel.name, _entityType: "company" }, focus);
        },
      });
    } else {
      rows.push({ label: "parent company", value: String(summary.parent_company) });
    }
  }
  if (block?.operator && block.operator !== block.owner) {
    rows.push({ label: "operator", value: block.operator });
  }
  if (productsStr) rows.push({ label: isPipeline ? "fuel / product" : "products", value: productsStr });
  if (isPipeline && summary.fuel_source) {
    rows.push({ label: "fuel source", value: String(summary.fuel_source) });
  }
  if (capacityStr) rows.push({ label: "capacity", value: capacityStr });
  if (isPipeline && summary.status) rows.push({ label: "status", value: String(summary.status) });
  if (isPipeline && summary.length_km) rows.push({ label: "length (km)", value: String(summary.length_km) });
  if (isPipeline && summary.diameter) {
    const d = String(summary.diameter);
    const units = summary.diameter_units ? ` ${summary.diameter_units}` : "";
    rows.push({ label: "diameter", value: d + units });
  }
  if (isPipeline && summary.gem_owner_entity_ids) {
    rows.push({ label: "GEM entity IDs", value: String(summary.gem_owner_entity_ids) });
  }
  if (isPipeline && summary.wiki_url) {
    rows.push({ label: "GEM wiki", value: String(summary.wiki_url) });
  }

  const hasContent = rows.length > 0;
  const title = isPipeline ? "Commercial (GEM)" : "Operator & capacity";

  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <EnrichmentHeader
          title={title}
          block={block}
          showRefresh={hasUuid && !isPipeline}
          entityType="asset"
          entityId={dossier.id}
        />
      </CardHeader>
      <CardContent>
        {isPipeline && (
          <p className="disclaimer mt-0 mb-2 text-xs">
            Owner and parent from GEM Global Oil Infrastructure Tracker (CC BY 4.0). GEM does not publish phone,
            email, or direct contact channels — use linked company dossiers or separate contact sources.
          </p>
        )}
        {hasContent ? (
          <>
            <EnrichmentDl rows={rows} />
            {block && <EnrichmentMeta block={block} />}
            {block && <EnrichmentLimitations block={block} />}
          </>
        ) : block ? (
          <>
            <p className="disclaimer mt-0 text-xs">
              {isPipeline
                ? "No GEM commercial attributes on file for this segment yet — run gem_pipeline_import or click a GEM-backed route."
                : "No operator or capacity on file — OSM tags may still appear in the summary above."}
            </p>
            <EnrichmentMeta block={block} />
            {block && <EnrichmentLimitations block={block} />}
          </>
        ) : (
          <p className="disclaimer mt-0 text-xs">
            {isPipeline
              ? "Not enriched yet — scheduled GEM import writes owner, capacity, and status into Postgres."
              : "Not enriched yet — scheduled background refresh reconciles OSM tags with curated terminal and capacity registries."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function profileRow(summary: Record<string, unknown>, key: string, label: string): { label: string; value: string } | null {
  const v = formatSummaryValue(summary[key]);
  return v ? { label, value: v } : null;
}

export function GemPipelineProfileSection({ dossier }: Props) {
  if (dossier.entity_type !== "asset") return null;
  const assetType = String(dossier.summary?.asset_type ?? "");
  if (assetType.toLowerCase() !== "pipeline") return null;

  const summary = dossier.summary ?? {};
  const timeline = [
    profileRow(summary, "proposal_year", "proposal year"),
    profileRow(summary, "construction_year", "construction year"),
    profileRow(summary, "start_years", "start year(s)"),
    profileRow(summary, "cancelled_year", "cancelled year"),
    profileRow(summary, "stop_year", "stop year"),
    profileRow(summary, "shelved_year", "shelved year"),
    profileRow(summary, "delay_type", "delay type"),
    profileRow(summary, "delay_note", "delay note"),
    profileRow(summary, "gem_last_updated", "GEM last updated"),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const route = [
    profileRow(summary, "start_location", "start location"),
    profileRow(summary, "start_country", "start country"),
    profileRow(summary, "start_sub_region", "start sub-region"),
    profileRow(summary, "start_region", "start region"),
    profileRow(summary, "end_location", "end location"),
    profileRow(summary, "end_country", "end country"),
    profileRow(summary, "end_sub_region", "end sub-region"),
    profileRow(summary, "end_region", "end region"),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const meta = [
    profileRow(summary, "cost", "cost"),
    profileRow(summary, "language", "local language name"),
    profileRow(summary, "countries", "countries"),
    profileRow(summary, "project_id", "GEM project ID"),
    profileRow(summary, "segment_key", "segment key"),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (timeline.length === 0 && route.length === 0 && meta.length === 0) return null;

  return (
    <Card size="sm" className="mb-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Pipeline profile (GEM)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {timeline.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Timeline</p>
            <EnrichmentDl rows={timeline} />
          </div>
        )}
        {route.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Route</p>
            <EnrichmentDl rows={route} />
          </div>
        )}
        {meta.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cost & metadata</p>
            <EnrichmentDl rows={meta} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
