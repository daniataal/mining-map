"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FeatureCollection } from "geojson";
import AppShell from "@/components/AppShell";
import EntityDossierPanel, { type MapSelection } from "@/components/EntityDossierPanel";
import {
  fetchIntelCommercialProfile,
  type IntelCargoMovement,
  type IntelCommercialProfile,
  type IntelImporter,
  type IntelInvestorPath,
  type IntelOpportunity,
  type IntelSTSPrediction,
} from "@/lib/energyApi";

type Props = {
  entityType: string;
  id: string;
  name?: string;
  legacy?: string;
};

function normalizedEntityType(value: string): "asset" | "company" | "vessel" {
  const clean = value.toLowerCase().replace(/s$/, "");
  if (clean === "company") return "company";
  if (clean === "vessel") return "vessel";
  return "asset";
}

function selectionFromRoute(entityType: string, id: string, name?: string, legacy?: string): MapSelection {
  const type = normalizedEntityType(entityType);
  if (type === "vessel") {
    return {
      mmsi: decodeURIComponent(id),
      name: name ? decodeURIComponent(name) : undefined,
      _entityType: "vessel",
      _layer: "vessels",
    };
  }
  return {
    id: decodeURIComponent(id),
    legacy_row_id: legacy ? decodeURIComponent(legacy) : undefined,
    name: name ? decodeURIComponent(name) : undefined,
    _entityType: type,
    _layer: type === "company" ? "companies" : "energy-assets",
  };
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

function typedArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function fmtScore(value?: number): string {
  if (value == null || Number.isNaN(value)) return "0";
  return Math.round(value).toLocaleString();
}

function fmtCompact(value: unknown): string {
  const n = numberValue(value);
  if (n == null || n === 0) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function chainStepName(node: Record<string, unknown>): string {
  return textValue(node.short_label) || textValue(node.step).replaceAll("_", " ") || "step";
}

function DossierIntelCard({
  label,
  title,
  meta,
  children,
}: {
  label: string;
  title: string;
  meta?: string;
  children?: ReactNode;
}) {
  return (
    <article className="commercial-card">
      <div className="commercial-card-head">
        <span>{label}</span>
        {meta && <strong>{meta}</strong>}
      </div>
      <h3>{title}</h3>
      {children}
    </article>
  );
}

function EmptyIntel({ children }: { children: ReactNode }) {
  return <p className="commercial-empty">{children}</p>;
}

function contactLabel(item: Record<string, unknown>): string {
  return textValue(item.role).replaceAll("_", " ") || textValue(item.tier) || "contact";
}

function bestContactLine(item: Record<string, unknown>): string {
  const nested = recordArray(item.contacts);
  const firstNested = nested[0];
  return [
    textValue(item.email) || textValue(firstNested?.email),
    textValue(item.phone) || textValue(firstNested?.phone),
    textValue(item.website),
    textValue(item.source_url) || textValue(item.register_source_url) || textValue(item.source_ref),
  ].filter(Boolean).join(" · ");
}

function ownershipRows(profile: IntelCommercialProfile | null): Record<string, unknown>[] {
  const linked = recordValue(profile?.linked_intel);
  const rows = [
    ...recordArray(profile?.ownership_chain),
    ...recordArray(linked?.ownership_chain),
  ];
  const ownershipIntel = recordValue(profile?.ownership_intel);
  rows.push(...recordArray(ownershipIntel?.history_candidates));
  rows.push(...recordArray(ownershipIntel?.registry_checks));
  return rows;
}

function CommercialDossierWorkspace({ selection }: { selection: MapSelection }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<IntelCommercialProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const entityType = (selection._entityType ?? "asset") as "asset" | "company" | "vessel";
    const entityID = entityType === "vessel" ? selection.mmsi : selection.id;
    if (!entityID) {
      setProfile(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    fetchIntelCommercialProfile(entityType, entityID)
      .then((nextProfile) => {
        if (cancelled) return;
        setProfile(nextProfile);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selection.id, selection.mmsi, selection.name, selection._entityType]);

  const linked = profile?.linked_intel ?? {};
  const paths = typedArray<IntelInvestorPath>(linked.investor_paths);
  const opportunities = typedArray<IntelOpportunity>(linked.opportunities);
  const cargo = typedArray<IntelCargoMovement>(linked.cargo_movements);
  const importers = typedArray<IntelImporter>(linked.importers);
  const sts = typedArray<IntelSTSPrediction>(linked.sts_predictions);
  const contacts = [
    ...recordArray(profile?.commercial_contacts),
    ...recordArray(profile?.contacts),
  ];
  const ownership = ownershipRows(profile);
  const exposures = [
    ...recordArray(profile?.investor_exposures),
    ...recordArray(linked.investor_exposures),
  ];
  const evidenceCount = paths.length + opportunities.length + cargo.length + importers.length + sts.length + contacts.length + ownership.length + exposures.length;

  return (
    <section className="commercial-dossier-workspace">
      <div className="commercial-workspace-head">
        <div>
          <span>Commercial intelligence</span>
          <h2>Chains, counterparties, vessels, and risk</h2>
        </div>
        <strong>{loading ? "loading" : `${evidenceCount} linked item${evidenceCount === 1 ? "" : "s"}`}</strong>
      </div>

      <div className="commercial-section-grid">
        <section id="chain">
          <div className="commercial-section-title">
            <strong>Chain</strong>
            <span>{paths.length} path{paths.length === 1 ? "" : "s"}</span>
          </div>
          {paths.length === 0 ? (
            <EmptyIntel>No investor/control chain is attached to this entity yet.</EmptyIntel>
          ) : paths.slice(0, 4).map((item) => {
            const chain = recordArray(item.control_chain);
            return (
              <DossierIntelCard
                key={item.id}
                label={item.evidence_label ?? "inferred"}
                title={item.investor?.name || "reported investor path"}
                meta={fmtScore(item.score)}
              >
                {item.commercial_thesis && <p>{item.commercial_thesis}</p>}
                <div className="commercial-chain-mini">
                  {chain.slice(0, 7).map((node, idx) => (
                    <span key={`${item.id}-${idx}`}>
                      <b>{chainStepName(node)}</b>
                      <em>{textValue(node.label) || textValue(node.asset)}</em>
                    </span>
                  ))}
                </div>
              </DossierIntelCard>
            );
          })}
        </section>

        <section id="buyers">
          <div className="commercial-section-title">
            <strong>Buyers and importers</strong>
            <span>{importers.length} linked</span>
          </div>
          {importers.length === 0 ? (
            <EmptyIntel>No direct importer record is linked to this entity yet.</EmptyIntel>
          ) : importers.map((item) => (
            <DossierIntelCard
              key={`${item.company_id || item.name}-${item.product_code}-${item.origin_country?.country_code}`}
              label={item.evidence_label ?? "reported"}
              title={item.name || "reported importer"}
              meta={item.product_code}
            >
              <p>
                {[item.origin_country?.country_code ? `from ${item.origin_country.country_code}` : "", fmtCompact(item.quantity?.value), item.quantity?.unit, item.latest_month ? shortDate(item.latest_month) : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </DossierIntelCard>
          ))}
        </section>

        <section id="suppliers">
          <div className="commercial-section-title">
            <strong>Supplier and lane opportunities</strong>
            <span>{opportunities.length} lanes</span>
          </div>
          {opportunities.length === 0 ? (
            <EmptyIntel>No scored lane opportunity is linked to this entity yet.</EmptyIntel>
          ) : opportunities.map((item) => {
            const supplier = item.evidence?.find((evidence) => textValue(evidence.role) === "supplier_asset");
            const buyer = item.evidence?.find((evidence) => textValue(evidence.role) === "buyer_asset");
            return (
              <DossierIntelCard
                key={item.id}
                label={item.evidence_grade ?? "inferred"}
                title={`${item.commodity ?? "oil/gas"} · ${item.origin_country ?? "?"} -> ${item.destination_country ?? "?"}`}
                meta={fmtScore(item.score)}
              >
                <p>{[textValue(supplier?.asset_name) || "supplier side", textValue(buyer?.asset_name) || "buyer side"].join(" -> ")}</p>
                <div className="commercial-score-row">
                  <span>supplier {fmtScore(item.score_breakdown?.supplier_reality)}</span>
                  <span>buyer {fmtScore(item.score_breakdown?.buyer_reality)}</span>
                  <span>market {fmtScore(item.score_breakdown?.market_pressure)}</span>
                </div>
              </DossierIntelCard>
            );
          })}
        </section>

        <section id="vessels">
          <div className="commercial-section-title">
            <strong>Vessels and cargo</strong>
            <span>{cargo.length + sts.length} items</span>
          </div>
          {cargo.length === 0 && sts.length === 0 ? (
            <EmptyIntel>No linked cargo or commercial STS movement is attached yet.</EmptyIntel>
          ) : (
            <>
              {cargo.map((item) => {
                const qty = item.quantity?.best ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}` : "";
                return (
                  <DossierIntelCard
                    key={`${item.source}-${item.id}`}
                    label={item.evidence_label ?? "estimated"}
                    title={item.vessel_name || item.imo || item.mmsi || "cargo movement"}
                    meta={item.product_family}
                  >
                    <p>{[qty, item.owner_name ? `owner ${item.owner_name}` : "", item.route_hint?.latest_destination ? `dest ${item.route_hint.latest_destination}` : ""].filter(Boolean).join(" · ")}</p>
                  </DossierIntelCard>
                );
              })}
              {sts.map((item) => {
                const payload = item.payload ?? {};
                return (
                  <DossierIntelCard
                    key={item.id}
                    label={item.evidence_label ?? "predicted"}
                    title={[payload.vessel_a_name, payload.vessel_b_name].map((value) => String(value ?? "")).filter(Boolean).join(" / ") || "STS pair"}
                    meta={`${fmtScore(item.confidence_score)} confidence`}
                  >
                    <p>{[textValue(payload.product_hint), item.horizon_hours ? `${item.horizon_hours}h horizon` : ""].filter(Boolean).join(" · ")}</p>
                  </DossierIntelCard>
                );
              })}
            </>
          )}
        </section>

        <section id="contacts">
          <div className="commercial-section-title">
            <strong>Contacts and ownership</strong>
            <span>{contacts.length + ownership.length + exposures.length} records</span>
          </div>
          {contacts.length === 0 && ownership.length === 0 && exposures.length === 0 ? (
            <EmptyIntel>No manager, contact, ownership, or investor exposure record is attached yet.</EmptyIntel>
          ) : (
            <>
              {contacts.slice(0, 6).map((item, idx) => (
                <DossierIntelCard
                  key={`contact-${idx}-${textValue(item.company_id) || textValue(item.name)}`}
                  label={contactLabel(item)}
                  title={textValue(item.name) || textValue(item.company_id) || "source-backed contact"}
                  meta={textValue(item.country_code) || textValue(item.shipvault_country)}
                >
                  <p>{bestContactLine(item) || "source-backed contact bundle"}</p>
                </DossierIntelCard>
              ))}
              {ownership.slice(0, 6).map((item, idx) => (
                <DossierIntelCard
                  key={`ownership-${idx}-${textValue(item.owner_entity_id) || textValue(item.label) || textValue(item.name)}`}
                  label={textValue(item.evidence_label) || textValue(item.status) || "source-backed"}
                  title={textValue(item.owner_name) || textValue(item.label) || textValue(item.name) || textValue(item.check) || "ownership evidence"}
                  meta={textValue(item.parent_name) || textValue(recordValue(item.parent)?.name) || textValue(item.source)}
                >
                  <p>{[textValue(item.operator_name), textValue(item.detail), textValue(item.previous_ownership_status)].filter(Boolean).join(" · ") || "ownership, registry, or historical identity clue"}</p>
                </DossierIntelCard>
              ))}
              {exposures.slice(0, 4).map((item, idx) => (
                <DossierIntelCard
                  key={`exposure-${idx}-${textValue(item.id)}`}
                  label={textValue(item.exposure_type) || "investor"}
                  title={textValue(item.investor_name) || "investor exposure"}
                  meta={fmtCompact(item.exposure_value)}
                >
                  <p>{[textValue(item.commodity), textValue(item.country_code), textValue(item.exposure_unit)].filter(Boolean).join(" · ")}</p>
                </DossierIntelCard>
              ))}
            </>
          )}
        </section>

        <section id="risk">
          <div className="commercial-section-title">
            <strong>Risk and gaps</strong>
            <span>evidence limits</span>
          </div>
          <DossierIntelCard label="risk" title="Current limitations">
            <ul className="commercial-risk-list">
              {paths.length === 0 && <li>No investor/control path is linked yet.</li>}
              {opportunities.length === 0 && <li>No scored supplier/buyer lane touches this entity yet.</li>}
              {cargo.length === 0 && <li>No cargo clue currently resolves to this entity.</li>}
              {contacts.length === 0 && <li>No direct manager/contact bundle is attached yet.</li>}
              {selection._entityType === "asset" && <li>Asset role may be operator, terminal, buyer, supplier, or route node depending on source evidence.</li>}
              <li>Every inferred opportunity should be verified before outreach.</li>
            </ul>
          </DossierIntelCard>
        </section>
      </div>
    </section>
  );
}

export default function DossierPageClient({ entityType, id, name, legacy }: Props) {
  const initialSelection = useMemo(
    () => selectionFromRoute(entityType, id, name, legacy),
    [entityType, id, name, legacy],
  );
  const [selection, setSelection] = useState<MapSelection>(initialSelection);
  const [relationshipLines, setRelationshipLines] = useState<FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);

  const type = normalizedEntityType(entityType);
  const mappedFeatures = relationshipLines.features.length;

  return (
    <AppShell maxWidth="full">
      <div className="intel-dossier-page">
        <div className="intel-dossier-page-head">
          <div>
            <Link href="/" className="intel-dossier-back">
              Terminal
            </Link>
            <h1>{selection.name || selection.id || selection.mmsi || "Commercial dossier"}</h1>
            <span>{type} dossier</span>
          </div>
          <div className="intel-dossier-kpis">
            <span>
              <small>mapped chain</small>
              <strong>{mappedFeatures}</strong>
            </span>
            <span>
              <small>surface</small>
              <strong>{type}</strong>
            </span>
          </div>
        </div>

        <div className="intel-dossier-layout">
          <section className="intel-dossier-main">
            <EntityDossierPanel
              selection={selection}
              vertical="energy"
              onRelationshipLines={setRelationshipLines}
              onNavigate={(feat) => {
                setSelection({
                  ...feat,
                  _entityType: feat._entityType ?? "asset",
                  _layer: feat._layer ?? "energy-assets",
                });
              }}
            />
            <CommercialDossierWorkspace selection={selection} />
          </section>
          <aside className="intel-dossier-side">
            <div>
              <strong>Commercial index</strong>
              <span>Chain</span>
              <span>Buyers</span>
              <span>Suppliers</span>
              <span>Vessels</span>
              <span>Contacts</span>
              <span>Evidence</span>
              <span>Risk</span>
            </div>
            <div>
              <strong>Current workspace</strong>
              <span>{selection._entityType ?? type}</span>
              {selection.id && <span>{selection.id}</span>}
              {selection.mmsi && <span>MMSI {selection.mmsi}</span>}
              {selection.legacy_row_id && <span>{selection.legacy_row_id}</span>}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
