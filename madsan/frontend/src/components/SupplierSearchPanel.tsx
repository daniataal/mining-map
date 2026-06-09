"use client";

import { useCallback, useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

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

export default function SupplierSearchPanel() {
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

  const search = useCallback(async (overrides?: Partial<Preset & { q: string }>) => {
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
    const res = await fetch(`${API_BASE}/api/energy/suppliers/search?${params}`, authFetchOpts);
    setResults(res.ok ? await res.json() : []);
    setSelected(null);
    setLoading(false);
  }, [q, commodity, country, nearLat, nearLon, radiusKm]);

  function applyPreset(preset: Preset) {
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
    const res = await fetch(`${API_BASE}/api/energy/companies/${id}`, authFetchOpts);
    setSelected(res.ok ? await res.json() : null);
  }

  return (
    <div style={{ fontSize: 13 }}>
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
              <div style={{ color: "var(--muted)", fontSize: 10 }}>
                conf {s.confidence_score ?? "—"} · ev {s.evidence_count ?? 0} · contacts {s.contact_count ?? 0} · {s.tier ?? "—"}
              </div>
            </button>
          </li>
        ))}
      </ul>
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
            {(selected.evidence ?? []).length === 0 && <li style={{ color: "var(--muted)" }}>No evidence rows yet — run backfill or re-ingest</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
