"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  ClipboardList,
  Factory,
  Pickaxe,
  Radio,
  Search,
  Settings,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Badge } from "@/components/ui/badge";
import { confidenceTierClass, confidenceTierLabel } from "@/lib/confidenceTier";
import { authFetchOpts } from "@/lib/auth";
import { canUse, FEATURE, fetchMe, type MeResponse } from "@/lib/entitlements";
import { API_BASE } from "@/lib/layers";
import EntityDossierPanel, { type MapSelection } from "./EntityDossierPanel";
import IntelligenceMap, { type MapRuntimeStatus } from "./IntelligenceMap";
import LiveIntelPanel from "./LiveIntelPanel";
import SearchPalette from "./SearchPalette";
import SupplierSearchPanel from "./SupplierSearchPanel";
import TickerTrendBar from "./TickerTrendBar";
import WatchlistsPanel, { useDealWatchAvailable } from "./WatchlistsPanel";

type Vertical = "energy" | "metals";
type Panel = "intel" | "suppliers" | "live" | "watch";

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

function tierBadgeVariant(tier: string): "verified" | "partial" {
  return tier === "eia_open_data" ? "verified" : "partial";
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
  const [me, setMe] = useState<MeResponse | null>(null);
  const canDealWatch = useDealWatchAvailable(me);

  const onRuntimeStatus = useCallback((status: MapRuntimeStatus) => {
    setMapStatus(status);
  }, []);

  useEffect(() => {
    fetchMe().then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/core/ticker`, authFetchOpts)
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
    fetch(`${API_BASE}/api/metals/licenses/summary`, authFetchOpts)
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

  const confidenceVariant = (score?: number | string): "verified" | "partial" | "destructive" | "muted" => {
    const cls = confidenceTierClass(score);
    if (cls === "tier-high") return "verified";
    if (cls === "tier-mid") return "partial";
    if (cls === "tier-low") return "destructive";
    return "muted";
  };

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
              <Badge variant="partial" title="Bunker register — no price feed">STUB</Badge>
            ) : null}
          </span>
        ))}
        <Badge variant={tierBadgeVariant(tickerTier)} title={tickerDisclaimer}>
          {tickerTier === "eia_open_data" ? "EIA OPEN DATA" : "REF PRICES"}
        </Badge>
        <Badge variant="warn">LIVE AIS — limited Gulf coverage</Badge>
        <button type="button" className="ticker-search" onClick={() => setSearchOpen(true)}>
          <Search size={12} style={{ display: "inline", marginRight: 4, verticalAlign: "-2px" }} />
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
          <button className={vertical === "energy" ? "active" : ""} title="Energy" onClick={() => { setVertical("energy"); setPanel("intel"); }}>
            <Zap size={18} />
          </button>
          <button className={vertical === "metals" ? "active" : ""} title="Metals" onClick={() => { setVertical("metals"); setPanel("intel"); }}>
            <Pickaxe size={18} />
          </button>
          <Link href={vertical === "metals" ? "/deals?vertical=metals" : "/deals"} className="rail-link" title="Deals">
            <ClipboardList size={18} />
          </Link>
          <Link href="/portal" className="rail-link" title="Supplier portal">
            <Upload size={18} />
          </Link>
          <button className={panel === "suppliers" ? "active" : ""} title="Suppliers" onClick={() => setPanel("suppliers")}>
            <Factory size={18} />
          </button>
          <button className={panel === "live" ? "active" : ""} title="Live intel" onClick={() => setPanel("live")}>
            <Radio size={18} />
          </button>
          <button className={panel === "watch" ? "active" : ""} title="Watchlists" onClick={() => setPanel("watch")}>
            <Bell size={18} />
          </button>
          <Link href="/admin" className="rail-link" title="Admin">
            <Settings size={18} />
          </Link>
        </nav>
        <IntelligenceMap
          vertical={vertical}
          selection={selected}
          onSelect={onMapSelect}
          mapFocus={mapFocus}
          relationshipLines={relationshipLines}
          onRuntimeStatus={onRuntimeStatus}
          entitlements={me?.entitlements}
        />
        <aside className="panel">
          <header className="panel-header">
            <span className="panel-title">
              {panel === "suppliers"
                ? "Supplier discovery"
                : panel === "live"
                  ? "Live intel"
                  : panel === "watch"
                    ? "Watchlists"
                    : selected?.name
                      ? String(selected.name)
                      : vertical === "metals"
                        ? "Metals intelligence"
                        : "Intelligence"}
            </span>
            {panel === "intel" && (
              <span className="panel-header-badges">
                <Badge variant="outline">{vertical}</Badge>
                {selected ? (
                  <Badge
                    variant={confidenceVariant(selected.confidence_score)}
                    title={`Confidence: ${confidenceTierLabel(selected.confidence_score)}`}
                  >
                    {confidenceTierLabel(selected.confidence_score)}
                  </Badge>
                ) : (
                  <Badge variant="muted">No selection</Badge>
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
            <div className="panel-onboarding-hint">
              Toggle <strong>Mining licenses</strong> or <strong>Smelters</strong> on the map — cadastre coverage is partial.
            </div>
          )}
          {panel === "intel" && !selected && vertical === "energy" && (
            <div className="panel-onboarding-hint">
              Use the <strong>layers</strong> control on the map to toggle infrastructure, vessels, and STS/MCR overlays.
            </div>
          )}
          <div className="body">
            <AnimatePresence mode="wait">
              <motion.div
                key={
                  panel === "suppliers"
                    ? "suppliers"
                    : panel === "live"
                      ? "live"
                      : panel === "watch"
                        ? "watch"
                        : selected?.id ?? selected?.mmsi ?? "empty"
                }
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {panel === "suppliers" ? (
                  <SupplierSearchPanel
                    canSearch={canUse(me, FEATURE.supplierDiscovery)}
                    authed={!!me?.uid}
                  />
                ) : panel === "live" ? (
                  <LiveIntelPanel
                    onSelectLead={(feat) => {
                      setSelected(feat);
                      setPanel("intel");
                      setVertical("energy");
                    }}
                  />
                ) : panel === "watch" ? (
                  <WatchlistsPanel
                    selection={selected}
                    authed={!!me?.uid}
                    canDealWatch={canDealWatch}
                    onSelect={(feat) => {
                      setSelected(feat);
                      setPanel("intel");
                    }}
                  />
                ) : (
                  <EntityDossierPanel
                    selection={selected}
                    vertical={vertical}
                    onRelationshipLines={setRelationshipLines}
                    onOpenLive={() => setPanel("live")}
                    onNavigate={(feat, focus) => {
                      setSelected(feat);
                      setPanel("intel");
                      if (focus) setMapFocus(focus);
                      if (feat._entityType === "asset") {
                        setVertical(feat.asset_type === "mine" ? "metals" : "energy");
                      } else if (feat._entityType === "company" || feat._entityType === "vessel") {
                        setVertical("energy");
                      }
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
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
        {vertical === "energy" && mapStatus.gulfAisLimited && (
          <>
            <span className="statusbar-sep">·</span>
            <span className="status-gulf-indicator" title="Open AIS is sparse in Persian Gulf / Hormuz — empty map ≠ no traffic">
              Gulf AIS limited
            </span>
          </>
        )}
      </div>
    </div>
  );
}
