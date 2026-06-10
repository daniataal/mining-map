"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DealChangesPanel, { type DealChanges } from "@/components/DealChangesPanel";
import DealGraphPanel from "@/components/DealGraphPanel";
import FeedbackFlywheel from "@/components/FeedbackFlywheel";
import { authFetchOpts, clearLegacyAuthTokens } from "@/lib/auth";
import { canUse, FEATURE, fetchMe, type MeResponse } from "@/lib/entitlements";
import { API_BASE } from "@/lib/layers";

const fetchOpts = authFetchOpts;

type DealVertical = "energy" | "metals";

const SAMPLE_ENERGY_VLSFO: Record<string, string> = {
  commodity: "VLSFO",
  quantity: "5000",
  quantity_unit: "MT",
  location: "Fujairah, UAE",
  seller: "Peninsula Fuel Supply LLC",
  buyer: "Sample Buyer Ltd",
  incoterm: "FOB",
  price: "612",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const SAMPLE_ENERGY_EN590: Record<string, string> = {
  commodity: "EN590 diesel",
  quantity: "10000",
  quantity_unit: "MT",
  location: "Rotterdam, NL",
  seller: "Sample Trader BV",
  buyer: "Sample Buyer Ltd",
  incoterm: "CIF",
  price: "780",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const SAMPLE_ENERGY_CRUDE: Record<string, string> = {
  commodity: "Brent crude",
  quantity: "50000",
  quantity_unit: "bbl",
  location: "Rotterdam, NL",
  seller: "Sample Refinery SA",
  buyer: "Sample Buyer Ltd",
  incoterm: "FOB",
  price: "82",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const SAMPLE_ENERGY_JET: Record<string, string> = {
  commodity: "Jet A-1",
  quantity: "2000",
  quantity_unit: "MT",
  location: "Singapore",
  seller: "Sample Aviation Fuel Pte",
  buyer: "Sample Buyer Ltd",
  incoterm: "DAP",
  price: "920",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const ENERGY_SAMPLES = [
  { label: "Sample VLSFO · Fujairah", seed: SAMPLE_ENERGY_VLSFO },
  { label: "Sample EN590 · Rotterdam", seed: SAMPLE_ENERGY_EN590 },
  { label: "Sample crude · Rotterdam", seed: SAMPLE_ENERGY_CRUDE },
  { label: "Sample Jet A-1 · Singapore", seed: SAMPLE_ENERGY_JET },
] as const;

const SAMPLE_METAL_GOLD: Record<string, string> = {
  commodity: "Gold (AU)",
  quantity: "500",
  quantity_unit: "kg",
  location: "Dubai, UAE",
  seller: "Sample Refinery DMCC",
  buyer: "Sample Buyer Ltd",
  incoterm: "CIF",
  price: "68500",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const SAMPLE_METAL_COPPER: Record<string, string> = {
  commodity: "Copper cathode",
  quantity: "1000",
  quantity_unit: "MT",
  location: "Lusaka, Zambia",
  seller: "Sample Copper Traders Ltd",
  buyer: "Sample Buyer Ltd",
  incoterm: "FOB",
  price: "9850",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const SAMPLE_METAL_SILVER: Record<string, string> = {
  commodity: "Silver (Ag)",
  quantity: "10000",
  quantity_unit: "oz",
  location: "London, UK",
  seller: "Sample Bullion Desk Ltd",
  buyer: "Sample Buyer Ltd",
  incoterm: "DAP",
  price: "31.5",
  currency: "USD",
  claimed_vessel_mmsi: "",
  claimed_asset_id: "",
};

const METAL_SAMPLES = [
  { label: "Sample gold · Dubai", seed: SAMPLE_METAL_GOLD },
  { label: "Sample copper · Zambia", seed: SAMPLE_METAL_COPPER },
  { label: "Sample silver · London", seed: SAMPLE_METAL_SILVER },
] as const;

type VerifyResult = {
  deal_id?: string;
  confidence_score?: number;
  confidence_status?: string;
  dd_recommendation?: string;
  positive_evidence?: string[];
  red_flags?: string[];
  warnings?: string[];
  missing_documents?: string[];
  recommended_questions?: string[];
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

const sampleButtonStyle = {
  padding: "8px 12px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--accent)",
  fontWeight: 600,
  cursor: "pointer",
} as const;

export default function DealsPage() {
  const [sellerDefault, setSellerDefault] = useState("");
  const [dealVertical, setDealVertical] = useState<DealVertical>("energy");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [packGraph, setPackGraph] = useState<PackGraph | null>(null);
  const [dealChanges, setDealChanges] = useState<DealChanges | null>(null);
  const [changesError, setChangesError] = useState("");
  const [watchBusy, setWatchBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authError, setAuthError] = useState("");
  const [formSeed, setFormSeed] = useState<Record<string, string> | null>(null);
  const [packDownloadMsg, setPackDownloadMsg] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setSellerDefault(p.get("seller") ?? "");
    if (p.get("vertical") === "metals") setDealVertical("metals");
  }, []);

  useEffect(() => {
    clearLegacyAuthTokens();
    fetchMe()
      .then((profile) => {
        setMe(profile);
        setAuthed(!!profile?.uid);
      })
      .catch(() => {
        setMe(null);
        setAuthed(false);
      });
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
    const profile = await fetchMe();
    setMe(profile);
    setAuthed(!!profile?.uid);
  }

  const canVerify = canUse(me, FEATURE.dealVerification);
  const canExportPack = canUse(me, FEATURE.dealPackExport);
  const canWatch = canUse(me, FEATURE.dealWatch);

  async function refreshChanges(dealId: string) {
    setChangesError("");
    const res = await fetch(`${API_BASE}/api/deals/${dealId}/changes`, fetchOpts);
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    if (res.status === 403) {
      setChangesError("Your plan does not include deal change monitoring.");
      return;
    }
    if (!res.ok) {
      setChangesError(await res.text());
      return;
    }
    setDealChanges((await res.json()) as DealChanges);
  }

  async function toggleWatch(watch: boolean) {
    if (!result?.deal_id) return;
    setWatchBusy(true);
    setChangesError("");
    const res = await fetch(`${API_BASE}/api/deals/${result.deal_id}/watch`, {
      ...fetchOpts,
      method: watch ? "POST" : "DELETE",
    });
    if (!res.ok) {
      setChangesError(await res.text());
      setWatchBusy(false);
      return;
    }
    await refreshChanges(result.deal_id);
    setWatchBusy(false);
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
        claimed_asset_id: body.claimed_asset_id || undefined,
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

  async function downloadPack(fmt: "json" | "markdown" | "html") {
    if (!result?.deal_id) return;
    setPackDownloadMsg("");
    const res = await fetch(`${API_BASE}/api/deals/${result.deal_id}/pack?format=${fmt}`, fetchOpts);
    if (res.status === 401) {
      setAuthed(false);
      setPackDownloadMsg("Session expired — sign in again.");
      return;
    }
    if (res.status === 403) {
      setPackDownloadMsg("Your plan does not include deal pack export.");
      return;
    }
    if (!res.ok) {
      setPackDownloadMsg(await res.text());
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename=([^;]+)/);
    const filename = filenameMatch?.[1]?.replace(/"/g, "") ?? `madsan-deal-pack.${fmt === "markdown" ? "md" : fmt}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (authed === null) {
    return (
      <main style={{ maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
        <p style={{ color: "var(--muted)" }}>Checking session…</p>
      </main>
    );
  }

  const isMetals = dealVertical === "metals";

  return (
    <main style={{ maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/" style={{ fontSize: 12 }}>← Terminal</Link>
      </p>
      <h1>Deal verification</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["energy", "metals"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setDealVertical(v);
              setFormSeed(null);
              setResult(null);
              setPackGraph(null);
            }}
            style={{
              padding: "6px 12px",
              background: dealVertical === v ? "var(--accent)" : "var(--panel)",
              color: dealVertical === v ? "#000" : "var(--text)",
              border: "1px solid var(--border)",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {v === "energy" ? "Energy" : "Metals"}
          </button>
        ))}
      </div>
      <p style={{ color: "var(--muted)" }}>
        {isMetals
          ? "Metals commodities — gold, copper, silver, concentrates. DD rules, sanctions, relationship graph."
          : "Energy commodities — EN590, VLSFO, fuel oil, crude, jet. DD rules, corridor checks, OpenSanctions, relationship graph."}
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
      {authed && !result && (
        <div style={{ marginBottom: "1rem", padding: "1rem", background: "var(--panel)", border: "1px solid var(--border)", fontSize: 13 }}>
          <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>No deal verified yet — load a sample or fill the form below.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isMetals ? (
              METAL_SAMPLES.map(({ label, seed }) => (
                <button key={label} type="button" onClick={() => setFormSeed({ ...seed })} style={sampleButtonStyle}>
                  {label}
                </button>
              ))
            ) : (
              ENERGY_SAMPLES.map(({ label, seed }) => (
                <button key={label} type="button" onClick={() => setFormSeed({ ...seed })} style={sampleButtonStyle}>
                  {label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {authed && !canVerify && (
        <p style={{ color: "var(--warn)", marginBottom: "1rem" }}>
          Your plan does not include deal verification. Contact admin for entitlement override.
        </p>
      )}
      {authed && (
        <form key={formSeed ? JSON.stringify(formSeed) : sellerDefault || "default"} onSubmit={verify} style={{ display: "grid", gap: "0.75rem" }}>
          {["commodity", "quantity", "quantity_unit", "location", "seller", "buyer", "incoterm", "price", "currency", "claimed_vessel_mmsi", "claimed_asset_id"].map((f) => (
            <label key={f} style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {f}
              <input
                name={f}
                defaultValue={formSeed?.[f] ?? (f === "seller" ? sellerDefault : f === "quantity_unit" && !formSeed ? "MT" : undefined)}
                required={f !== "buyer" && f !== "incoterm" && f !== "price" && f !== "currency" && f !== "claimed_vessel_mmsi" && f !== "claimed_asset_id"}
                style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
            </label>
          ))}
          <button type="submit" disabled={loading || !canVerify} style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>
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
          {result.positive_evidence && result.positive_evidence.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Positive evidence</strong>
              <ul>{result.positive_evidence.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
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
          {result.missing_documents && result.missing_documents.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Missing documents</strong>
              <ul>{result.missing_documents.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {result.recommended_questions && result.recommended_questions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Recommended questions</strong>
              <ul>{result.recommended_questions.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          <DealGraphPanel graph={packGraph} />
          <DealChangesPanel
            changes={dealChanges}
            error={changesError || undefined}
            watchBusy={watchBusy}
            onWatch={result.deal_id && canWatch ? () => toggleWatch(true) : undefined}
            onUnwatch={result.deal_id && canWatch ? () => toggleWatch(false) : undefined}
          />
          {result.deal_id && !canWatch && (
            <p style={{ color: "var(--muted)", marginTop: 8 }}>Deal watch requires a plan with deal monitoring.</p>
          )}
          {result.deal_id && (
            <>
              {canExportPack ? (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {(["json", "markdown", "html"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => downloadPack(fmt)}
                      style={{ padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--accent)", fontSize: 12, cursor: "pointer" }}
                    >
                      Download {fmt.toUpperCase()} pack
                    </button>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--muted)", marginTop: 12 }}>Pack export is not included in your plan.</p>
              )}
              {packDownloadMsg && <p style={{ color: "#f87171", marginTop: 8 }}>{packDownloadMsg}</p>}
              <FeedbackFlywheel mode="deal" dealId={result.deal_id} />
            </>
          )}
        </div>
      )}
      <p className="disclaimer">Intelligence pack — not legal or trading advice.</p>
    </main>
  );
}
