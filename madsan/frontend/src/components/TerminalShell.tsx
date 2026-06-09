"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { confidenceTierClass, confidenceTierLabel } from "@/lib/confidenceTier";
import { API_BASE } from "@/lib/layers";
import EntityDossierPanel, { type MapSelection } from "./EntityDossierPanel";
import IntelligenceMap, { type MapRuntimeStatus } from "./IntelligenceMap";
import SearchPalette from "./SearchPalette";
import SupplierSearchPanel from "./SupplierSearchPanel";
import TickerTrendBar from "./TickerTrendBar";

type Vertical = "energy" | "metals";
type Panel = "intel" | "suppliers";

type TickerQuote = {
  label: string;
  price: number;
  currency: string;
  unit: string;
  change_pct?: number;
  tier?: string;
  disclaimer?: string;
};

function isCrudeQuote(q: TickerQuote): boolean {
  const label = q.label.toLowerCase();
  return label.includes("wti") || label.includes("brent");
}

function formatStatusTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function wsStatusLabel(state: MapRuntimeStatus["wsState"]): string {
  switch (state) {
    case "connected":
      return "Live";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Offline";
    default:
      return "N/A";
  }
}

function dataTierHint(tier: string): string {
  if (tier === "eia_open_data") return "EIA daily spot (1-day lag)";
  return "Reference stub — not exchange";
}

export default function TerminalShell() {
  const [vertical, setVertical] = useState<Vertical>("energy");
  const [panel, setPanel] = useState<Panel>("intel");
  const [selected, setSelected] = useState<MapSelection | null>(null);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [relationshipLines, setRelationshipLines] = useState<FeatureCollection>({ type: "FeatureCollection", features: [] });
  const [searchOpen, setSearchOpen] = useState(false);
  const [metalsSummary, setMetalsSummary] = useState<{ mines?: number; countries?: number } | null>(null);
  const [quotes, setQuotes] = useState<TickerQuote[]>([]);
  const [tickerTier, setTickerTier] = useState<string>("reference_stub");
  const [tickerDisclaimer, setTickerDisclaimer] = useState("Reference stub — not live exchange");
  const [tickerRefreshedAt, setTickerRefreshedAt] = useState<string | undefined>();
  const [mapStatus, setMapStatus] = useState<MapRuntimeStatus>({
    wsState: "connecting",
    activeLayerCount: 2,
  });

  const onRuntimeStatus = useCallback((status: MapRuntimeStatus) => {
    setMapStatus(status);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/core/ticker`)
      .then((r) => r.json())
      .then((d: { quotes?: TickerQuote[]; tier?: string; disclaimer?: string; observed_at?: string }) => {
        setQuotes(d.quotes ?? []);
        if (d.tier) setTickerTier(d.tier);
        if (d.disclaimer) setTickerDisclaimer(d.disclaimer);
        setTickerRefreshedAt(d.observed_at ?? new Date().toISOString());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (vertical !== "metals") return;
    fetch(`${API_BASE}/api/metals/licenses/summary`)
      .then((r) => r.json())
      .then(setMetalsSummary)
      .catch(() => {});
  }, [vertical]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onMapSelect = useCallback((feat: MapSelection | null) => {
    setSelected(feat);
    if (feat) setPanel("intel");
  }, []);

  const onSearchSelect = useCallback((feat: MapSelection, focus?: { lat: number; lng: number }) => {
    setSelected(feat);
    setPanel("intel");
    if (focus) setMapFocus(focus);
    if (feat._entityType === "asset" && feat.asset_type === "mine") {
      setVertical("metals");
    } else if (feat._entityType === "vessel" || feat._entityType === "company") {
      setVertical("energy");
    }
  }, []);

  return (
    <div className="terminal">
      <div className="ticker">
        <strong>MADSAN</strong>
        {(quotes.length ? quotes : [{ label: "Brent" }, { label: "VLSFO Singapore" }, { label: "Gold spot" }] as TickerQuote[]).map((q) => (
          <span key={q.label} className="ticker-item" title={q.disclaimer ?? tickerDisclaimer}>
            {isCrudeQuote(q) && q.change_pct != null ? <TickerTrendBar changePct={q.change_pct} /> : null}
            {q.label}{" "}
            <strong>
              {q.price != null
                ? `${q.currency ?? "USD"} ${q.price.toLocaleString(undefined, { maximumFractionDigits: 1 })}${q.unit ?? ""}${q.change_pct != null ? ` (${q.change_pct > 0 ? "+" : ""}${q.change_pct}%)` : ""}`
                : "—"}
            </strong>
            {q.tier === "reference_stub" && q.label.toLowerCase().includes("vlsfo") ? (
              <span className="badge partial compact" title="Bunker register — no price feed">STUB</span>
            ) : null}
          </span>
        ))}
        {tickerTier === "eia_open_data" ? (
          <span className="badge verified" title={tickerDisclaimer}>EIA OPEN DATA</span>
        ) : (
          <span className="badge partial" title={tickerDisclaimer}>REF PRICES</span>
        )}
        <span className="badge partial">LIVE AIS — limited Gulf coverage</span>
        <button type="button" className="ticker-search" onClick={() => setSearchOpen(true)}>
          Search ⌘K
        </button>
      </div>
      <SearchPalette
        open={searchOpen}
        vertical={vertical}
        onClose={() => setSearchOpen(false)}
        onSelect={onSearchSelect}
      />
      <div className="shell">
        <nav className="rail">
          <button className={vertical === "energy" ? "active" : ""} title="Energy" onClick={() => { setVertical("energy"); setPanel("intel"); }}>⚡</button>
          <button className={vertical === "metals" ? "active" : ""} title="Metals" onClick={() => { setVertical("metals"); setPanel("intel"); }}>⛏</button>
          <Link href="/deals" className="rail-link" title="Deals">📋</Link>
          <Link href="/portal" className="rail-link" title="Supplier portal">📤</Link>
          <button className={panel === "suppliers" ? "active" : ""} title="Suppliers" onClick={() => setPanel("suppliers")}>🏭</button>
          <Link href="/admin" className="rail-link" title="Admin">⚙</Link>
        </nav>
        <IntelligenceMap
          vertical={vertical}
          onSelect={onMapSelect}
          mapFocus={mapFocus}
          relationshipLines={relationshipLines}
          onRuntimeStatus={onRuntimeStatus}
        />
        <aside className="panel">
          <header className="panel-header">
            <span className="panel-title">
              {panel === "suppliers"
                ? "Supplier discovery"
                : selected?.name
                  ? String(selected.name)
                  : vertical === "metals"
                    ? "Metals intelligence"
                    : "Intelligence"}
            </span>
            {panel === "intel" && (
              <span className="panel-header-badges">
                <span className="badge partial compact">{vertical}</span>
                {selected ? (
                  <span
                    className={`badge compact ${confidenceTierClass(selected.confidence_score)}`}
                    title={`Confidence: ${confidenceTierLabel(selected.confidence_score)}`}
                  >
                    {confidenceTierLabel(selected.confidence_score)}
                  </span>
                ) : (
                  <span className="badge tier-none compact">No selection</span>
                )}
              </span>
            )}
          </header>
          {vertical === "metals" && metalsSummary && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
              {metalsSummary.mines ?? 0} mines · {metalsSummary.countries ?? 0} countries (license cadastre)
            </div>
          )}
          {panel === "intel" && !selected && vertical === "metals" && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)", lineHeight: 1.4 }}>
              Toggle <strong style={{ color: "var(--text)", fontWeight: 600 }}>Mining licenses</strong> or{" "}
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>Smelters</strong>. Cadastre coverage is partial — not all countries ingested.
            </div>
          )}
          {panel === "intel" && !selected && vertical === "energy" && (
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)", lineHeight: 1.4 }}>
              Toggle <strong style={{ color: "var(--text)", fontWeight: 600 }}>Pipelines</strong> (z≥4).{" "}
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>Vessels</strong> — Gulf AIS coverage is limited by provider.
            </div>
          )}
          <div className="body">
            {panel === "suppliers" ? (
              <SupplierSearchPanel />
            ) : (
              <EntityDossierPanel
                selection={selected}
                onRelationshipLines={setRelationshipLines}
                onNavigate={(feat, focus) => {
                  setSelected(feat);
                  setPanel("intel");
                  if (focus) setMapFocus(focus);
                  if (feat._entityType === "asset") {
                    setVertical(feat.asset_type === "mine" ? "metals" : "energy");
                  } else if (feat._entityType === "company") {
                    setVertical("energy");
                  }
                }}
              />
            )}
          </div>
        </aside>
      </div>
      <div className="statusbar">
        <span className={`status-dot ${mapStatus.wsState}`} title="WebSocket viewport subscription">
          WS {wsStatusLabel(mapStatus.wsState)}
        </span>
        <span className="statusbar-sep">·</span>
        <span>{vertical === "energy" ? "Energy" : "Metals"} vertical</span>
        <span className="statusbar-sep">·</span>
        <span>{mapStatus.activeLayerCount} layer{mapStatus.activeLayerCount === 1 ? "" : "s"} on</span>
        <span className="statusbar-sep">·</span>
        <span title={tickerDisclaimer}>{dataTierHint(tickerTier)}</span>
        <span className="statusbar-sep">·</span>
        <span title={mapStatus.lastWsAt ? `Last AIS push ${mapStatus.lastWsAt}` : undefined}>
          Ticker {formatStatusTime(tickerRefreshedAt)}
          {mapStatus.lastWsAt ? ` · AIS ${formatStatusTime(mapStatus.lastWsAt)}` : ""}
        </span>
      </div>
    </div>
  );
}
