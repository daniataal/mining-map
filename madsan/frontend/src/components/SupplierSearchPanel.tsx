"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/layers";

type Supplier = {
  id: string;
  name: string;
  country_code?: string;
  commodities?: string[];
  confidence_score?: number;
  rank_score?: number;
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

export default function SupplierSearchPanel() {
  const [q, setQ] = useState("");
  const [commodity, setCommodity] = useState("vlsfo");
  const [country, setCountry] = useState("");
  const [results, setResults] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CompanyDetail | null>(null);

  async function search() {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (commodity) params.set("commodity", commodity);
    if (country) params.set("country", country);
    const res = await fetch(`${API_BASE}/api/energy/suppliers/search?${params}`);
    setResults(res.ok ? await res.json() : []);
    setSelected(null);
    setLoading(false);
  }

  async function openSupplier(id: string) {
    const res = await fetch(`${API_BASE}/api/energy/companies/${id}`);
    setSelected(res.ok ? await res.json() : null);
  }

  return (
    <div style={{ fontSize: 13 }}>
      <input
        placeholder="Search suppliers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%", marginBottom: 6, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
      />
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          placeholder="Commodity"
          value={commodity}
          onChange={(e) => setCommodity(e.target.value)}
          style={{ flex: 1, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
        <input
          placeholder="Country"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          style={{ width: 56, padding: 6, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </div>
      <button
        type="button"
        onClick={search}
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
                {s.country_code} · {s.commodities?.join(", ")} · conf {s.confidence_score ?? "—"}
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
