"use client";

/**
 * Deal playground — build deals visually on a clean map: place suppliers,
 * buyers, facilities, vessels and transport legs, connect them, and manage
 * due diligence per node. Custom entities are allowed; real database
 * entities attach via search.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import AppShell from "@/components/AppShell";
import AuthGate from "@/components/auth/AuthGate";
import { applyBasemapTuning } from "@/lib/basemapLabels";
import { MAP_STYLE_URL } from "@/lib/layers";
import {
  addLink,
  addNode,
  createDeal,
  deleteDeal,
  deleteLink,
  deleteNode,
  fetchDealGraph,
  listDeals,
  searchEntities,
  updateDeal,
  updateNode,
  type DealGraph,
  type DealNode,
  type DealSummary,
  type SearchHit,
} from "@/lib/dealPlaygroundApi";

const NODE_KINDS = [
  { kind: "supplier", label: "Supplier", color: "#5dffc8" },
  { kind: "buyer", label: "Buyer", color: "#60a5fa" },
  { kind: "facility", label: "Facility", color: "#fbbf24" },
  { kind: "vessel", label: "Vessel", color: "#c084fc" },
  { kind: "transport", label: "Transport", color: "#94a3b8" },
  { kind: "custom", label: "Custom", color: "#f472b6" },
] as const;

const DD_STATUSES = [
  { value: "pending", label: "Pending", color: "#94a3b8" },
  { value: "in_review", label: "In review", color: "#fbbf24" },
  { value: "verified", label: "Verified", color: "#34d399" },
  { value: "rejected", label: "Rejected", color: "#f87171" },
] as const;

const LINK_ROLES = ["supply", "transport", "storage", "sale", "finance"] as const;

const kindColor = (kind: string) => NODE_KINDS.find((k) => k.kind === kind)?.color ?? "#f472b6";
const ddColor = (s: string) => DD_STATUSES.find((d) => d.value === s)?.color ?? "#94a3b8";
const ddLabel = (s: string) => DD_STATUSES.find((d) => d.value === s)?.label ?? s;

function graphToGeoJSON(graph: DealGraph | null): { nodes: FeatureCollection; links: FeatureCollection } {
  const nodeFeatures: FeatureCollection = { type: "FeatureCollection", features: [] };
  const linkFeatures: FeatureCollection = { type: "FeatureCollection", features: [] };
  if (!graph) return { nodes: nodeFeatures, links: linkFeatures };
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const n of graph.nodes) {
    if (n.lat == null || n.lon == null) continue;
    nodeFeatures.features.push({
      type: "Feature",
      id: n.id,
      geometry: { type: "Point", coordinates: [n.lon, n.lat] },
      properties: {
        node_id: n.id,
        name: n.name,
        kind: n.kind,
        dd_status: n.dd_status,
        color: kindColor(n.kind),
        ring: ddColor(n.dd_status),
      },
    });
  }
  for (const l of graph.links) {
    const a = byId.get(l.from_node);
    const b = byId.get(l.to_node);
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    linkFeatures.features.push({
      type: "Feature",
      id: l.id,
      geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      properties: { link_id: l.id, role: l.role, name: `${a.name} → ${b.name}` },
    });
  }
  return { nodes: nodeFeatures, links: linkFeatures };
}

export default function PlaygroundPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [graph, setGraph] = useState<DealGraph | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newCommodity, setNewCommodity] = useState("");

  const [placeKind, setPlaceKind] = useState<string | null>(null);
  const [pendingEntity, setPendingEntity] = useState<SearchHit | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkRole, setLinkRole] = useState<string>("supply");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  // Refs so stable map handlers see current interaction state.
  const stateRef = useRef({ placeKind, pendingEntity, linkFrom, linkRole, graphId: graph?.id ?? null });
  stateRef.current = { placeKind, pendingEntity, linkFrom, linkRole, graphId: graph?.id ?? null };

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );

  const refreshDeals = useCallback(async () => {
    setDeals(await listDeals());
  }, []);

  const refreshGraph = useCallback(async (dealId: string) => {
    try {
      setGraph(await fetchDealGraph(dealId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load deal");
    }
  }, []);

  useEffect(() => {
    void refreshDeals();
  }, [refreshDeals]);

  // Entity search (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      void searchEntities(query).then(setHits);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const handleMapClick = useCallback(async (lngLat: { lng: number; lat: number }) => {
    const { placeKind: kind, pendingEntity: pending, graphId } = stateRef.current;
    if (!graphId) return;
    if (pending) {
      await addNode(graphId, {
        kind: pending.entity_type === "vessel" ? "vessel" : kind ?? "custom",
        name: pending.name,
        ref_entity_type: pending.entity_type,
        ref_entity_id: pending.id,
        lat: lngLat.lat,
        lon: lngLat.lng,
        metadata: { mmsi: pending.mmsi, asset_type: pending.asset_type, country: pending.country_code },
      });
      setPendingEntity(null);
      setPlaceKind(null);
      await refreshGraph(graphId);
      return;
    }
    if (kind) {
      const label = NODE_KINDS.find((k) => k.kind === kind)?.label ?? "Node";
      await addNode(graphId, { kind, name: `New ${label.toLowerCase()}`, lat: lngLat.lat, lon: lngLat.lng });
      setPlaceKind(null);
      await refreshGraph(graphId);
    }
  }, [refreshGraph]);

  const handleNodeClick = useCallback(async (nodeId: string) => {
    const { linkFrom: from, linkRole: role, graphId } = stateRef.current;
    if (from && graphId && from !== nodeId) {
      try {
        await addLink(graphId, from, nodeId, role);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to link");
      }
      setLinkFrom(null);
      await refreshGraph(graphId);
      return;
    }
    setSelectedNodeId(nodeId);
  }, [refreshGraph]);

  // Map bootstrap.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE_URL,
      center: [20, 25],
      zoom: 1.8,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      applyBasemapTuning(map);
      map.addSource("deal-links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("deal-nodes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "deal-links-line",
        type: "line",
        source: "deal-links",
        paint: { "line-color": "#5dffc8", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "deal-nodes-ring",
        type: "circle",
        source: "deal-nodes",
        paint: {
          "circle-radius": 11,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "ring"],
        },
      });
      map.addLayer({
        id: "deal-nodes-dot",
        type: "circle",
        source: "deal-nodes",
        paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-opacity": 0.95 },
      });
      map.addLayer({
        id: "deal-nodes-label",
        type: "symbol",
        source: "deal-nodes",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.6],
          "text-anchor": "top",
        },
        paint: { "text-color": "#e2e8f0", "text-halo-color": "#0a0e14", "text-halo-width": 1.4 },
      });
      setMapReady(true);
    });
    map.on("click", (e) => {
      if (!map.getLayer("deal-nodes-dot")) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ["deal-nodes-dot", "deal-nodes-ring"] });
      if (features.length > 0) {
        const nodeId = features[0].properties?.node_id as string | undefined;
        if (nodeId) {
          void handleNodeClick(nodeId);
          return;
        }
      }
      void handleMapClick(e.lngLat);
    });
    map.on("mouseenter", "deal-nodes-dot", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "deal-nodes-dot", () => {
      map.getCanvas().style.cursor = "";
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [handleMapClick, handleNodeClick]);

  // Redraw on graph change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const { nodes, links } = graphToGeoJSON(graph);
    (map.getSource("deal-nodes") as maplibregl.GeoJSONSource | undefined)?.setData(nodes);
    (map.getSource("deal-links") as maplibregl.GeoJSONSource | undefined)?.setData(links);
  }, [graph, mapReady]);

  // Crosshair cursor in placement mode.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placeKind || pendingEntity ? "crosshair" : "";
  }, [placeKind, pendingEntity]);

  async function handleCreateDeal() {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const id = await createDeal(newTitle.trim(), newCommodity.trim());
      setNewTitle("");
      setNewCommodity("");
      await refreshDeals();
      await refreshGraph(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to create deal");
    }
    setBusy(false);
  }

  async function handleAttachEntity(hit: SearchHit) {
    const graphId = graph?.id;
    if (!graphId) return;
    if (hit.latitude != null && hit.longitude != null) {
      const kind =
        hit.entity_type === "vessel" ? "vessel"
        : hit.entity_type === "asset" ? "facility"
        : "supplier";
      await addNode(graphId, {
        kind,
        name: hit.name,
        ref_entity_type: hit.entity_type,
        ref_entity_id: hit.id,
        lat: hit.latitude,
        lon: hit.longitude,
        metadata: { mmsi: hit.mmsi, asset_type: hit.asset_type, country: hit.country_code },
      });
      setQuery("");
      setHits([]);
      await refreshGraph(graphId);
      mapRef.current?.flyTo({ center: [hit.longitude, hit.latitude], zoom: 6 });
    } else {
      // No coordinates — user picks the spot on the map.
      setPendingEntity(hit);
      setQuery("");
      setHits([]);
    }
  }

  async function patchSelectedNode(patch: Partial<DealNode>) {
    if (!graph || !selectedNode) return;
    await updateNode(graph.id, selectedNode.id, patch);
    await refreshGraph(graph.id);
  }

  const ddSummary = useMemo(() => {
    if (!graph) return null;
    const total = graph.nodes.length;
    const verified = graph.nodes.filter((n) => n.dd_status === "verified").length;
    const rejected = graph.nodes.filter((n) => n.dd_status === "rejected").length;
    return { total, verified, rejected, pct: total > 0 ? Math.round((verified / total) * 100) : 0 };
  }, [graph]);

  return (
    <AppShell maxWidth="full">
      <AuthGate>
        <div style={{ display: "flex", height: "calc(100vh - 110px)", gap: 0, border: "1px solid var(--border)" }}>
          <div ref={mapContainer} style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {(placeKind || pendingEntity) && (
              <div style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
                background: "var(--panel)", border: "1px solid var(--accent)", padding: "6px 14px",
                fontSize: 12, color: "var(--accent)", fontWeight: 600,
              }}>
                {pendingEntity
                  ? `Click the map to place "${pendingEntity.name}"`
                  : `Click the map to place a ${placeKind}`}
                <button
                  type="button"
                  onClick={() => { setPlaceKind(null); setPendingEntity(null); }}
                  style={{ marginLeft: 10, background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
                >
                  cancel
                </button>
              </div>
            )}
            {linkFrom && (
              <div style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5,
                background: "var(--panel)", border: "1px solid #60a5fa", padding: "6px 14px",
                fontSize: 12, color: "#60a5fa", fontWeight: 600,
              }}>
                Linking ({linkRole}) — click the target node
                <button
                  type="button"
                  onClick={() => setLinkFrom(null)}
                  style={{ marginLeft: 10, background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
                >
                  cancel
                </button>
              </div>
            )}
          </div>

          <aside style={{ width: 390, flexShrink: 0, overflowY: "auto", background: "var(--panel)", borderLeft: "1px solid var(--border)", padding: 14, fontSize: 13 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Deal playground</h2>
            <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 12px" }}>
              Place suppliers, buyers, facilities and vessels on the map, connect them into deals, and track due diligence per party.
            </p>
            {error && (
              <p style={{ color: "#f87171", fontSize: 12 }}>
                {error}{" "}
                <button type="button" onClick={() => setError("")} style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}>×</button>
              </p>
            )}

            {!graph && (
              <>
                <div style={{ marginBottom: 14, padding: 10, border: "1px solid var(--border)", background: "var(--bg)" }}>
                  <strong style={{ fontSize: 12 }}>New deal</strong>
                  <input
                    placeholder="Deal title (e.g. EN590 Rotterdam → Lagos)"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    style={{ width: "100%", marginTop: 6, padding: 7, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                  <input
                    placeholder="Commodity (optional)"
                    value={newCommodity}
                    onChange={(e) => setNewCommodity(e.target.value)}
                    style={{ width: "100%", marginTop: 6, padding: 7, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateDeal}
                    disabled={busy || !newTitle.trim()}
                    style={{ marginTop: 8, padding: "7px 14px", background: "var(--accent)", color: "#000", border: 0, fontWeight: 600, cursor: "pointer" }}
                  >
                    Create &amp; open
                  </button>
                </div>
                <strong style={{ fontSize: 12 }}>Your deals</strong>
                {deals.length === 0 && <p style={{ color: "var(--muted)", fontSize: 12 }}>No deals yet — create one above.</p>}
                {deals.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => { setSelectedNodeId(null); void refreshGraph(d.id); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", marginTop: 6, padding: 10,
                      background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{d.title || "(untitled deal)"}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                      {d.commodity || "no commodity"} · {d.status} · {d.nodes} parties · {d.links} connections
                      {d.nodes > 0 && ` · DD ${d.dd_verified}/${d.nodes} verified`}
                    </div>
                  </button>
                ))}
              </>
            )}

            {graph && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setGraph(null); setSelectedNodeId(null); setPlaceKind(null); setLinkFrom(null); void refreshDeals(); }}
                    style={{ background: "none", border: "1px solid var(--border)", color: "var(--muted)", padding: "3px 8px", cursor: "pointer", fontSize: 11 }}
                  >
                    ← deals
                  </button>
                  <input
                    value={graph.title}
                    onChange={(e) => setGraph({ ...graph, title: e.target.value })}
                    onBlur={() => void updateDeal(graph.id, { title: graph.title })}
                    style={{ flex: 1, fontWeight: 700, fontSize: 14, padding: 5, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <input
                    value={graph.commodity}
                    placeholder="commodity"
                    onChange={(e) => setGraph({ ...graph, commodity: e.target.value })}
                    onBlur={() => void updateDeal(graph.id, { commodity: graph.commodity })}
                    style={{ flex: 1, padding: 5, fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                  <select
                    value={graph.status}
                    onChange={(e) => { setGraph({ ...graph, status: e.target.value }); void updateDeal(graph.id, { status: e.target.value }); }}
                    style={{ padding: 5, fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                  >
                    {["draft", "active", "on_hold", "closed"].map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>

                {ddSummary && ddSummary.total > 0 && (
                  <div style={{ marginBottom: 10, padding: 8, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 11 }}>
                    <strong>Due diligence:</strong> {ddSummary.verified}/{ddSummary.total} verified ({ddSummary.pct}%)
                    {ddSummary.rejected > 0 && <span style={{ color: "#f87171" }}> · {ddSummary.rejected} rejected</span>}
                    <div style={{ height: 4, background: "var(--border)", marginTop: 5 }}>
                      <div style={{ height: 4, width: `${ddSummary.pct}%`, background: "#34d399" }} />
                    </div>
                  </div>
                )}

                <strong style={{ fontSize: 12 }}>Place on map</strong>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "6px 0 10px" }}>
                  {NODE_KINDS.map((k) => (
                    <button
                      key={k.kind}
                      type="button"
                      onClick={() => { setPlaceKind(placeKind === k.kind ? null : k.kind); setPendingEntity(null); setLinkFrom(null); }}
                      style={{
                        padding: "5px 9px", fontSize: 11, cursor: "pointer", fontWeight: 600,
                        background: placeKind === k.kind ? k.color : "var(--bg)",
                        color: placeKind === k.kind ? "#000" : k.color,
                        border: `1px solid ${k.color}`,
                      }}
                    >
                      + {k.label}
                    </button>
                  ))}
                </div>

                <strong style={{ fontSize: 12 }}>Attach from database</strong>
                <input
                  placeholder="Search companies, facilities, vessels…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ width: "100%", marginTop: 6, padding: 7, fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
                {hits.length > 0 && (
                  <div style={{ border: "1px solid var(--border)", borderTop: 0, maxHeight: 180, overflowY: "auto" }}>
                    {hits.map((h) => (
                      <button
                        key={`${h.entity_type}-${h.id}`}
                        type="button"
                        onClick={() => void handleAttachEntity(h)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 12, background: "var(--bg)", border: 0, borderBottom: "1px solid var(--border)", color: "var(--text)", cursor: "pointer" }}
                      >
                        <span style={{ fontWeight: 600 }}>{h.name}</span>{" "}
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>
                          {h.entity_type}{h.asset_type ? ` · ${h.asset_type}` : ""}{h.country_code ? ` · ${h.country_code}` : ""}
                          {h.latitude == null ? " · no coords (click map to place)" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <strong style={{ fontSize: 12 }}>Parties ({graph.nodes.length})</strong>
                  {graph.nodes.length === 0 && (
                    <p style={{ color: "var(--muted)", fontSize: 12 }}>Use “Place on map” or attach entities from the database.</p>
                  )}
                  {graph.nodes.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        marginTop: 6, padding: 8, background: "var(--bg)", cursor: "pointer",
                        border: `1px solid ${selectedNodeId === n.id ? kindColor(n.kind) : "var(--border)"}`,
                      }}
                      onClick={() => setSelectedNodeId(selectedNodeId === n.id ? null : n.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 9, background: kindColor(n.kind), flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                        <span style={{ fontSize: 10, color: ddColor(n.dd_status), border: `1px solid ${ddColor(n.dd_status)}`, padding: "1px 6px" }}>
                          {ddLabel(n.dd_status)}
                        </span>
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                        {n.kind}{n.ref_entity_type ? ` · linked ${n.ref_entity_type}` : " · custom"}
                      </div>

                      {selectedNodeId === n.id && (
                        <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }} onClick={(e) => e.stopPropagation()}>
                          <input
                            value={n.name}
                            onChange={(e) => setGraph({ ...graph, nodes: graph.nodes.map((x) => x.id === n.id ? { ...x, name: e.target.value } : x) })}
                            onBlur={(e) => void patchSelectedNode({ name: e.target.value })}
                            style={{ width: "100%", padding: 6, fontSize: 12, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                          />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <select
                              value={n.kind}
                              onChange={(e) => void patchSelectedNode({ kind: e.target.value })}
                              style={{ flex: 1, padding: 5, fontSize: 11, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                            >
                              {NODE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                            </select>
                            <select
                              value={n.dd_status}
                              onChange={(e) => void patchSelectedNode({ dd_status: e.target.value })}
                              style={{ flex: 1, padding: 5, fontSize: 11, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                            >
                              {DD_STATUSES.map((d) => <option key={d.value} value={d.value}>DD: {d.label}</option>)}
                            </select>
                          </div>
                          <textarea
                            placeholder="Due diligence notes (KYC, docs, sanctions, site visit…)"
                            defaultValue={n.dd_notes ?? ""}
                            onBlur={(e) => void patchSelectedNode({ dd_notes: e.target.value })}
                            rows={2}
                            style={{ width: "100%", marginTop: 6, padding: 6, fontSize: 11, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", resize: "vertical" }}
                          />
                          <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                            <select
                              value={linkRole}
                              onChange={(e) => setLinkRole(e.target.value)}
                              style={{ padding: 5, fontSize: 11, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
                            >
                              {LINK_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                            </select>
                            <button
                              type="button"
                              onClick={() => { setLinkFrom(n.id); setPlaceKind(null); setPendingEntity(null); }}
                              style={{ padding: "5px 10px", fontSize: 11, background: "var(--bg)", border: "1px solid #60a5fa", color: "#60a5fa", cursor: "pointer", fontWeight: 600 }}
                            >
                              Connect →
                            </button>
                            {n.lat != null && n.lon != null && (
                              <button
                                type="button"
                                onClick={() => mapRef.current?.flyTo({ center: [n.lon as number, n.lat as number], zoom: 7 })}
                                style={{ padding: "5px 10px", fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)", cursor: "pointer" }}
                              >
                                Zoom
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { void deleteNode(graph.id, n.id).then(() => { setSelectedNodeId(null); return refreshGraph(graph.id); }); }}
                              style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 11, background: "var(--bg)", border: "1px solid #f87171", color: "#f87171", cursor: "pointer" }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {graph.links.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 12 }}>Connections ({graph.links.length})</strong>
                    {graph.links.map((l) => {
                      const a = graph.nodes.find((n) => n.id === l.from_node);
                      const b = graph.nodes.find((n) => n.id === l.to_node);
                      return (
                        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", fontSize: 11 }}>
                          <span style={{ flex: 1 }}>
                            {a?.name ?? "?"} <span style={{ color: "var(--accent)" }}>—{l.role}→</span> {b?.name ?? "?"}
                          </span>
                          <button
                            type="button"
                            onClick={() => void deleteLink(graph.id, l.id).then(() => refreshGraph(graph.id))}
                            style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Delete deal "${graph.title}" and all its parties?`)) return;
                    void deleteDeal(graph.id).then(() => { setGraph(null); return refreshDeals(); });
                  }}
                  style={{ marginTop: 16, padding: "6px 12px", fontSize: 11, background: "none", border: "1px solid #f87171", color: "#f87171", cursor: "pointer" }}
                >
                  Delete deal
                </button>
                <p style={{ color: "var(--muted)", fontSize: 10, marginTop: 10 }}>
                  Custom parties are user-supplied and unverified until DD is completed. Linked database entities carry platform evidence.
                </p>
              </>
            )}
          </aside>
        </div>
      </AuthGate>
    </AppShell>
  );
}
