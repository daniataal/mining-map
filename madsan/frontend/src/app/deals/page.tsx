"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DealChangesPanel, { type DealChanges } from "@/components/DealChangesPanel";
import DealGraphPanel from "@/components/DealGraphPanel";
import { API_BASE } from "@/lib/layers";

const fetchOpts: RequestInit = { credentials: "include" };

type VerifyResult = {
  deal_id?: string;
  confidence_score?: number;
  confidence_status?: string;
  dd_recommendation?: string;
  red_flags?: string[];
  warnings?: string[];
  error?: string;
};

type PackGraph = {
  nodes?: Array<{
    id: string;
    entity_type: string;
    name: string;
    role?: string;
    asset_type?: string;
    mmsi?: string;
  }>;
  edges?: Array<{
    from: string;
    to: string;
    type: string;
    detail?: string;
  }>;
  summary?: { node_count?: number; edge_count?: number };
};

export default function DealsPage() {
  const [sellerDefault, setSellerDefault] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [packGraph, setPackGraph] = useState<PackGraph | null>(null);
  const [dealChanges, setDealChanges] = useState<DealChanges | null>(null);
  const [changesError, setChangesError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setSellerDefault(p.get("seller") ?? "");
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/core/auth/me`, fetchOpts)
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);

  async function ensureAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    const reg = await fetch(`${API_BASE}/api/core/auth/register`, {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name: "Deals user", tenant_slug: "default" }),
    });
    if (!reg.ok && reg.status !== 400) {
      setAuthError(await reg.text());
      return;
    }
    const login = await fetch(`${API_BASE}/api/core/auth/login`, {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) {
      setAuthError(await login.text());
      return;
    }
    setAuthed(true);
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setPackGraph(null);
    setDealChanges(null);
    setChangesError("");
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch(`${API_BASE}/api/deals/verify`, {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commodity: body.commodity,
        quantity: Number(body.quantity),
        quantity_unit: body.quantity_unit || "MT",
        location: body.location,
        seller: body.seller,
        buyer: body.buyer,
        incoterm: body.incoterm || "FOB",
        price: Number(body.price) || 0,
        currency: body.currency || "USD",
        claimed_vessel_mmsi: body.claimed_vessel_mmsi || undefined,
      }),
    });
    if (res.status === 401) {
      setAuthed(false);
      setResult({ error: "Session expired — sign in again." });
      setLoading(false);
      return;
    }
    if (res.status === 403) {
      setResult({ error: "Your plan does not include deal verification." });
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setResult({ error: await res.text() });
      setLoading(false);
      return;
    }
    const data = (await res.json()) as VerifyResult;
    setResult(data);
    if (data.deal_id) {
      const [packRes, changesRes] = await Promise.all([
        fetch(`${API_BASE}/api/deals/${data.deal_id}/pack?format=json`, fetchOpts),
        fetch(`${API_BASE}/api/deals/${data.deal_id}/changes`, fetchOpts),
      ]);
      if (packRes.status === 401 || changesRes.status === 401) {
        setAuthed(false);
        setResult({ ...data, error: "Session expired — sign in again." });
      } else {
        if (packRes.status === 403) {
          setResult({ ...data, error: "Your plan does not include deal pack export." });
        } else if (packRes.ok) {
          const pack = await packRes.json();
          setPackGraph(pack.relationship_graph ?? null);
        }
        if (changesRes.status === 403) {
          setChangesError("Your plan does not include deal change monitoring.");
        } else if (changesRes.ok) {
          setDealChanges((await changesRes.json()) as DealChanges);
        } else if (!changesRes.ok) {
          setChangesError(await changesRes.text());
        }
      }
    }
    setLoading(false);
  }

  if (authed === null) {
    return (
      <main style={{ maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
        <p style={{ color: "var(--muted)" }}>Checking session…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/" style={{ fontSize: 12 }}>← Terminal</Link>
      </p>
      <h1>Deal verification</h1>
      <p style={{ color: "var(--muted)" }}>
        Energy commodities — EN590, VLSFO, fuel oil, crude, jet. DD rules, corridor checks, OpenSanctions, relationship graph.
      </p>
      {authed === false && (
        <form onSubmit={ensureAuth} style={{ display: "grid", gap: "0.75rem", marginBottom: "1.5rem", padding: "1rem", background: "var(--panel)", border: "1px solid var(--border)" }}>
          <strong>Sign in to verify deals</strong>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            email
            <input name="email" type="email" required defaultValue="deals@madsan.dev" style={{ padding: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
            password
            <input name="password" type="password" required defaultValue="devpass123" style={{ padding: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </label>
          <button type="submit" style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>Register / sign in</button>
          {authError && <p style={{ color: "#f87171" }}>{authError}</p>}
        </form>
      )}
      {authed && (
        <form onSubmit={verify} style={{ display: "grid", gap: "0.75rem" }}>
          {["commodity", "quantity", "location", "seller", "buyer", "incoterm", "price", "currency", "claimed_vessel_mmsi"].map((f) => (
            <label key={f} style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {f}
              <input
                name={f}
                defaultValue={f === "seller" ? sellerDefault : undefined}
                required={f !== "buyer" && f !== "incoterm" && f !== "price" && f !== "currency" && f !== "claimed_vessel_mmsi"}
                style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
            </label>
          ))}
          <button type="submit" disabled={loading} style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>
            {loading ? "Verifying…" : "Verify deal"}
          </button>
        </form>
      )}
      {result && (
        <div style={{ marginTop: "1.5rem", fontSize: 13 }}>
          {result.error && <p style={{ color: "#f87171" }}>{result.error}</p>}
          {result.confidence_score != null && (
            <p>
              <span className={`badge ${result.confidence_score >= 80 ? "verified" : "partial"}`}>
                Score {result.confidence_score} — {result.confidence_status ?? ""}
              </span>
              {result.dd_recommendation && (
                <>
                  {" "}
                  <span className="badge warn">DD: {result.dd_recommendation}</span>
                </>
              )}
            </p>
          )}
          {result.red_flags && result.red_flags.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Red flags</strong>
              <ul>{result.red_flags.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {result.warnings && result.warnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Warnings</strong>
              <ul>{result.warnings.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          <DealGraphPanel graph={packGraph} />
          <DealChangesPanel changes={dealChanges} error={changesError || undefined} />
          {result.deal_id && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {(["json", "markdown", "html"] as const).map((fmt) => (
                <a
                  key={fmt}
                  href={`${API_BASE}/api/deals/${result.deal_id}/pack?format=${fmt}`}
                  download
                  style={{ padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", fontSize: 12, textDecoration: "none" }}
                >
                  Download {fmt.toUpperCase()} pack
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="disclaimer">Intelligence pack — not legal or trading advice.</p>
    </main>
  );
}
