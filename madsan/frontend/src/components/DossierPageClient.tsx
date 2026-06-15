"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { FeatureCollection } from "geojson";
import AppShell from "@/components/AppShell";
import EntityDossierPanel, { type MapSelection } from "@/components/EntityDossierPanel";
import {
  fetchIntelCommercialProfile,
  normalizeEvidenceLabel,
  shapeDossierWorkspace,
  type IntelCommercialProfile,
  type DossierGap,
  type DossierSectionItem,
  type DossierTabKey,
} from "@/lib/energyApi";

type Props = {
  entityType: string;
  id: string;
  name?: string;
  legacy?: string;
};

type CommercialChainSummary = {
  loading?: boolean;
  chainCount: number;
  evidenceCount: number;
  previewLines: string[];
};

const DOSSIER_TABS: Array<{ id: DossierTabKey; label: string }> = [
  { id: "chain", label: "Chain" },
  { id: "cargo", label: "Cargo" },
  { id: "buyers", label: "Buyers" },
  { id: "suppliers", label: "Suppliers" },
  { id: "ownership", label: "Ownership" },
  { id: "contacts", label: "Contacts" },
  { id: "market", label: "Market" },
  { id: "risk", label: "Risk" },
];

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

function EvidenceBadge({ label }: { label: string }) {
  const kind = normalizeEvidenceLabel(label);
  return <span className={`evidence-label evidence-label--${kind}`}>{kind}</span>;
}

function CommercialGap({ children }: { children: ReactNode }) {
  return <span className="commercial-gap">{children}</span>;
}

function sourceHref(item: DossierSectionItem): string | undefined {
  const raw = item.raw ?? {};
  const href =
    textValue(raw.source_url) ||
    textValue(raw.register_source_url) ||
    textValue(raw.url) ||
    textValue(raw.website);
  return href.startsWith("http") ? href : undefined;
}

function ActionCue({ label, href }: { label: string; href?: string }) {
  if (!href) return null;
  return (
    <a className="commercial-action commercial-action--enabled" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function DossierIntelCard({ item }: { item: DossierSectionItem }) {
  const href = sourceHref(item);
  const lines = item.lines.filter(Boolean);
  return (
    <article className="commercial-card">
      <div className="commercial-card-head">
        <EvidenceBadge label={item.evidenceLabel} />
        {item.meta && <strong>{item.meta}</strong>}
      </div>
      <h3>{item.title}</h3>
      {lines.length > 0 && (
        <div className="commercial-card-lines">
          {lines.map((line, idx) => (
            <p key={`${item.id}-line-${idx}`}>{line}</p>
          ))}
        </div>
      )}
      {href && (
        <div className="commercial-action-row">
          <ActionCue label="Open source" href={href} />
        </div>
      )}
    </article>
  );
}

function GapPanel({ title, gaps }: { title: string; gaps: DossierGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="commercial-gap-panel">
      <strong>{title}</strong>
      <div className="commercial-gap-row">
        {gaps.map((gap) => (
          <CommercialGap key={gap.key}>{gap.label}</CommercialGap>
        ))}
      </div>
      {gaps.some((gap) => gap.unlockHint) && (
        <div className="commercial-gap-hints">
          {gaps.map((gap) =>
            gap.unlockHint ? <p key={`${gap.key}-hint`}>{gap.unlockHint}</p> : null,
          )}
        </div>
      )}
    </div>
  );
}

function EmptyIntel({ children, unlock }: { children: ReactNode; unlock?: string }) {
  return (
    <div className="commercial-empty">
      <p>{children}</p>
      {unlock && <p className="commercial-empty-unlock">{unlock}</p>}
    </div>
  );
}

function emptyTabCopy(tab: DossierTabKey): { message: string; unlock: string } {
  switch (tab) {
    case "chain":
      return {
        message: "No investor, cargo, or recurring lane chain is attached to this entity yet.",
        unlock: "Investor paths, cargo commercial_chain, or opportunity lane geometry would unlock this tab.",
      };
    case "cargo":
      return {
        message: "No linked cargo movement or STS intelligence is attached yet.",
        unlock: "AIS destination, port calls, voyage evidence, or STS predictions would unlock cargo clues.",
      };
    case "buyers":
      return {
        message: "No direct importer or buyer asset record is linked yet.",
        unlock: "Trade-flow importers, destination market pressure, or buyer asset links would unlock buyer evidence.",
      };
    case "suppliers":
      return {
        message: "No scored supplier/lane opportunity is linked yet.",
        unlock: "Scored lane opportunities linking supplier assets to buyer pressure would unlock supplier cards.",
      };
    case "ownership":
      return {
        message: "No ownership chain, registry check, or investor exposure is attached yet.",
        unlock: "Ownership chain, registry checks, name history, or investor exposures would unlock ownership evidence.",
      };
    case "contacts":
      return {
        message: "No manager or contact bundle is attached yet.",
        unlock: "Shipvault contacts, cargo chain contact bundles, or operator outreach sources would unlock contact cards.",
      };
    case "market":
      return {
        message: "No benchmark or market-pressure context is linked yet.",
        unlock: "Pink Sheet benchmarks, JODI market stress, freight curves, or landed-margin adapters would unlock market context.",
      };
    case "risk":
      return {
        message: "No risk notes are attached yet.",
        unlock: "Evidence limits, stale data, weak ownership, and inferred opportunity notes would appear here.",
      };
  }
}

function DossierTabPanel({ activeTab, view }: { activeTab: DossierTabKey; view: ReturnType<typeof shapeDossierWorkspace> }) {
  const tab = view.tabs[activeTab];
  const empty = emptyTabCopy(activeTab);
  const gapTitle =
    activeTab === "market"
      ? "Market adapter gaps"
      : activeTab === "cargo"
        ? "Cargo and STS gaps"
        : activeTab === "risk"
          ? "Risk and verification gaps"
          : "Broker alpha gaps";
  return (
    <div className="commercial-tab-panel">
      {tab.items.length === 0 ? (
        <EmptyIntel unlock={empty.unlock}>{empty.message}</EmptyIntel>
      ) : (
        tab.items.map((item) => <DossierIntelCard key={item.id} item={item} />)
      )}
      <GapPanel title={gapTitle} gaps={tab.gaps} />
    </div>
  );
}

function CommercialDossierWorkspace({
  selection,
  activeTab,
  onTabChange,
  onSummaryChange,
}: {
  selection: MapSelection;
  activeTab: DossierTabKey;
  onTabChange: (tab: DossierTabKey) => void;
  onSummaryChange?: (summary: CommercialChainSummary) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<IntelCommercialProfile | null>(null);

  const entityType = (selection._entityType ?? "asset") as "asset" | "company" | "vessel";

  useEffect(() => {
    let cancelled = false;
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
  }, [selection.id, selection.mmsi, selection.name, entityType]);

  const view = useMemo(() => shapeDossierWorkspace(profile, entityType), [profile, entityType]);

  useEffect(() => {
    const chainItems = view.tabs.chain.items;
    onSummaryChange?.({
      loading,
      chainCount: loading ? 0 : view.tabs.chain.count,
      evidenceCount: loading ? 0 : view.evidenceCount,
      previewLines: chainItems
        .flatMap((item) => [item.title, ...item.lines.slice(0, 3)])
        .filter(Boolean)
        .slice(0, 8),
    });
  }, [loading, onSummaryChange, view]);

  return (
    <section className="commercial-dossier-workspace">
      <div className="commercial-workspace-head">
        <div>
          <span>Commercial intelligence</span>
          <h2>Analyst workspace</h2>
        </div>
        <strong>{loading ? "loading" : `${view.evidenceCount} linked item${view.evidenceCount === 1 ? "" : "s"}`}</strong>
      </div>

      <div className="commercial-dossier-tabs" role="tablist" aria-label="Commercial dossier sections">
        {DOSSIER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`commercial-dossier-tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
            <em>{view.tabs[tab.id].count}</em>
          </button>
        ))}
      </div>

      <div className="commercial-tab-content" role="tabpanel">
        {loading ? (
          <EmptyIntel>Loading commercial profile…</EmptyIntel>
        ) : (
          <DossierTabPanel activeTab={activeTab} view={view} />
        )}
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
  const [activeTab, setActiveTab] = useState<DossierTabKey>("chain");
  const [commercialSummary, setCommercialSummary] = useState<CommercialChainSummary>({
    loading: true,
    chainCount: 0,
    evidenceCount: 0,
    previewLines: [],
  });

  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);

  const type = normalizedEntityType(entityType);
  const mappedFeatures = relationshipLines.features.length;
  const chainKpiValue = mappedFeatures > 0 ? mappedFeatures : commercialSummary.chainCount;
  const chainKpiLabel = mappedFeatures > 0 ? "mapped chain" : commercialSummary.chainCount > 0 ? "intel chain" : "mapped chain";

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
              <small>{commercialSummary.loading ? "chain" : chainKpiLabel}</small>
              <strong>{commercialSummary.loading ? "…" : chainKpiValue}</strong>
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
              commercialChainSummary={commercialSummary}
              onRelationshipLines={setRelationshipLines}
              onNavigate={(feat) => {
                setSelection({
                  ...feat,
                  _entityType: feat._entityType ?? "asset",
                  _layer: feat._layer ?? "energy-assets",
                });
              }}
            />
            <CommercialDossierWorkspace
              selection={selection}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onSummaryChange={setCommercialSummary}
            />
          </section>
          <aside className="intel-dossier-side">
            <div>
              <strong>Commercial index</strong>
              {DOSSIER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`intel-dossier-index-link${activeTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
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
