"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { fetchBunkerSuppliers } from "@/lib/energyApi";
import { apiBase } from "@/lib/layers";

type Supplier = {
  id: string;
  name: string;
  country_code?: string;
  commodities?: string[];
  confidence_score?: number;
  rank_score?: number;
  evidence_count?: number;
  contact_count?: number;
  tier?: string;
  distance_km?: number;
};

type BunkerHub = {
  hub_key: string;
  port_name: string;
  locode?: string;
  country_code?: string;
  license_authority?: string;
  register_tier?: string;
  suppliers: Array<{
    id: string;
    name: string;
    phone?: string;
    email?: string;
    products?: string[];
    fuels_supplied?: string;
    source_url?: string;
    confidence_score?: number;
  }>;
};

type EvidenceClaim = {
  source_name: string;
  claim_type: string;
  confidence_score?: number;
  tier?: string;
};

type CompanyDetail = {
  name: string;
  evidence?: EvidenceClaim[];
};

type Preset = {
  label: string;
  commodity: string;
  country_code: string;
  near_lat?: number;
  near_lon?: number;
  radius_km?: number;
};

const PRESETS: Preset[] = [
  { label: "VLSFO near Singapore", commodity: "vlsfo", country_code: "", near_lat: 1.3521, near_lon: 103.8198, radius_km: 250 },
  { label: "Gold Ghana", commodity: "gold", country_code: "GH" },
];

type Props = {
  canSearch?: boolean;
  authed?: boolean;
};

export default function SupplierSearchPanel({ canSearch = true, authed = true }: Props) {
  const [mode, setMode] = useState<"bunker" | "search">("bunker");
  const [bunkerHubs, setBunkerHubs] = useState<BunkerHub[]>([]);
  const [bunkerTotal, setBunkerTotal] = useState(0);
  const [bunkerLoading, setBunkerLoading] = useState(true);
  const [expandedHub, setExpandedHub] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [commodity, setCommodity] = useState("");
  const [country, setCountry] = useState("");
  const [nearLat, setNearLat] = useState<number | "">("");
  const [nearLon, setNearLon] = useState<number | "">("");
  const [radiusKm, setRadiusKm] = useState<number | "">("");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [results, setResults] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CompanyDetail | null>(null);

  useEffect(() => {
    setBunkerLoading(true);
    fetchBunkerSuppliers()
      .then((data) => {
        setBunkerHubs(data.hubs ?? []);
        setBunkerTotal(data.supplier_count ?? 0);
        if (data.hubs?.[0]) setExpandedHub(data.hubs[0].hub_key);
      })
      .finally(() => setBunkerLoading(false));
  }, []);

  const search = useCallback(async (overrides?: Partial<Preset & { q: string }>) => {
    if (!canSearch) return;
    setLoading(true);
    const params = new URLSearchParams();
    const query = overrides?.q ?? q;
    const comm = overrides?.commodity ?? commodity;
    const cc = overrides?.country_code ?? country;
    const lat = overrides?.near_lat ?? (nearLat === "" ? undefined : nearLat);
    const lon = overrides?.near_lon ?? (nearLon === "" ? undefined : nearLon);
    const radius = overrides?.radius_km ?? (radiusKm === "" ? undefined : radiusKm);
    if (query) params.set("q", query);
    if (comm) params.set("commodity", comm);
    if (cc) params.set("country_code", cc);
    if (lat != null) params.set("near_lat", String(lat));
    if (lon != null) params.set("near_lon", String(lon));
    if (radius != null) params.set("radius_km", String(radius));
    const res = await fetch(`${apiBase()}/api/energy/suppliers/search?${params}`, authFetchOpts);
    if (res.status === 401 || res.status === 403) {
      setResults([]);
      setSelected(null);
      setLoading(false);
      return;
    }
    setResults(res.ok ? await res.json() : []);
    setSelected(null);
    setLoading(false);
  }, [q, commodity, country, nearLat, nearLon, radiusKm, canSearch]);

  function applyPreset(preset: Preset) {
    setMode("search");
    setActivePreset(preset.label);
    setCommodity(preset.commodity);
    setCountry(preset.country_code);
    setNearLat(preset.near_lat ?? "");
    setNearLon(preset.near_lon ?? "");
    setRadiusKm(preset.radius_km ?? "");
    void search({
      commodity: preset.commodity,
      country_code: preset.country_code,
      near_lat: preset.near_lat,
      near_lon: preset.near_lon,
      radius_km: preset.radius_km,
    });
  }

  async function openSupplier(id: string) {
    const res = await fetch(`${apiBase()}/api/energy/companies/${id}`, authFetchOpts);
    setSelected(res.ok ? await res.json() : null);
  }

  const tabBtn = (id: "bunker" | "search", label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setMode(id)}
      style={{
        flex: 1,
        padding: "6px 8px",
        fontSize: 11,
        fontWeight: 600,
        border: "1px solid var(--border)",
        background: mode === id ? "var(--accent)" : "var(--panel)",
        color: mode === id ? "#000" : "var(--text)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {tabBtn("bunker", "Licensed bunker register")}
        {tabBtn("search", "Ranked search")}
      </div>

      {mode === "bunker" && (
        <>
          <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 10px" }}>
            {bunkerLoading ? "Loading…" : `${bunkerTotal} licensed suppliers across ${bunkerHubs.length} bunkering hubs`} — from official port &amp; regulator lists (Fujairah, Singapore MPA, Rotterdam, Antwerp, Malta, UK, etc.).
          </p>
          {bunkerHubs.map((hub) => {
            const open = expandedHub === hub.hub_key;
            return (
              <div key={hub.hub_key} style={{ marginBottom: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
                <button
                  type="button"
                  onClick={() => setExpandedHub(open ? null : hub.hub_key)}
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: 0,
                    color: "var(--text)", cursor: "pointer", fontWeight: 600, fontSize: 12,
                  }}
                >
                  {hub.port_name}
                  <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                    {" "}
                    · {hub.suppliers.length} suppliers{hub.locode ? ` · ${hub.locode}` : ""}
                  </span>
                </button>
                {open && (
                  <ul style={{ listStyle: "none", margin: 0, padding: "0 10px 8px" }}>
                    {hub.suppliers.map((s) => (
                      <li key={s.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                        <button
                          type="button"
                          onClick={() => openSupplier(s.id)}
                          style={{ background: "none", border: 0, color: "var(--text)", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}
                        >
                          <strong>{s.name}</strong>
                          <div style={{ color: "var(--muted)", fontSize: 11 }}>
                            {(s.products ?? []).join(", ") || s.fuels_supplied || "marine fuel"}
                            {s.phone ? ` · ${s.phone}` : ""}
                          </div>
                          {s.email && <div style={{ color: "var(--accent)", fontSize: 10 }}>{s.email}</div>}
                          {s.source_url && (
                            <a href={s.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--muted)" }} onClick={(e) => e.stopPropagation()}>
                              Register source
                            </a>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="disclaimer" style={{ fontSize: 10, marginTop: 8 }}>
            Confirm licence status on the official register before deals. No bunker price feed — VLSFO ticker is a Brent-derived stub until a licensed price source is added.
          </p>
        </>
      )}

      {mode === "search" && (
        <>
          {!authed && (
            <p style={{ color: "var(--muted)", marginBottom: 10 }}>
              <a href="/login?next=/">Sign in</a> to run ranked supplier search and save watchlists.
            </p>
          )}
          {authed && !canSearch && (
            <p style={{ color: "var(--warn)", marginBottom: 10 }}>
              Your plan does not include supplier discovery. Upgrade to search ranked suppliers.
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: activePreset === p.label ? "var(--accent)" : "var(--panel)",
                  color: activePreset === p.label ? "#000" : "var(--text)",
                  cursor: "pointer",
                  fontWeight: activePreset === p.label ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            placeholder="Search suppliers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", marginBottom: 6, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              placeholder="Commodity"
              value={commodity}
              onChange={(e) => { setCommodity(e.target.value); setActivePreset(null); }}
              style={{ flex: 1, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <input
              placeholder="Country"
              value={country}
              onChange={(e) => { setCountry(e.target.value); setActivePreset(null); }}
              style={{ width: 56, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, fontSize: 11 }}>
            <input
              placeholder="Lat"
              value={nearLat}
              onChange={(e) => { setNearLat(e.target.value === "" ? "" : Number(e.target.value)); setActivePreset(null); }}
              style={{ flex: 1, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <input
              placeholder="Lon"
              value={nearLon}
              onChange={(e) => { setNearLon(e.target.value === "" ? "" : Number(e.target.value)); setActivePreset(null); }}
              style={{ flex: 1, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <input
              placeholder="km"
              value={radiusKm}
              onChange={(e) => { setRadiusKm(e.target.value === "" ? "" : Number(e.target.value)); setActivePreset(null); }}
              style={{ width: 48, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <button
            type="button"
            onClick={() => search()}
            disabled={loading}
            style={{ width: "100%", padding: 8, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600, marginBottom: 10 }}
          >
            {loading ? "Searching…" : "Rank suppliers"}
          </button>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {results.map((s) => (
              <li key={s.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => openSupplier(s.id)}
                  style={{ background: "none", border: 0, color: "var(--text)", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}
                >
                  <strong>{s.name}</strong>
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>
                    {s.country_code || "—"} · {s.commodities?.join(", ") || "—"} · rank {s.rank_score?.toFixed(1) ?? "—"}
                    {s.distance_km != null ? ` · ${s.distance_km.toFixed(0)} km` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <div style={{ marginTop: 12, padding: 10, background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }}>
          <strong>{selected.name}</strong>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>Evidence chain</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
            {(selected.evidence ?? []).slice(0, 8).map((e) => (
              <li key={`${e.claim_type}-${e.source_name}`}>
                {e.claim_type} <span style={{ color: "var(--muted)" }}>({e.source_name}{e.tier ? ` · ${e.tier}` : ""})</span>
              </li>
            ))}
            {(selected.evidence ?? []).length === 0 && <li style={{ color: "var(--muted)" }}>No evidence rows yet</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
