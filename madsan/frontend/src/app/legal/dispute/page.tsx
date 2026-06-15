"use client";

import Link from "next/link";
import { useState } from "react";
import { API_BASE } from "@/lib/layers";
import {
  LEGAL_CONTACT_EMAIL,
  fetchOpts,
  inputStyle,
  legalApiFallback,
  type LegalSubmitResult,
} from "@/lib/legalForm";

const REQUEST_TYPES = [
  { value: "correction", label: "Data correction — factual error in entity, map, or dossier" },
  { value: "dispute", label: "Dispute — challenge a flag, score, or inferred relationship" },
  { value: "appeal", label: "Appeal — review of a prior operator decision" },
] as const;

export default function LegalDisputePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LegalSubmitResult | null>(null);

  async function submitDispute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      request_type: String(fd.get("request_type") ?? "correction"),
      entity_type: String(fd.get("entity_type") ?? "").trim() || null,
      entity_id: String(fd.get("entity_id") ?? "").trim() || null,
      deal_id: String(fd.get("deal_id") ?? "").trim() || null,
      field_in_question: String(fd.get("field_in_question") ?? "").trim() || null,
      description: String(fd.get("description") ?? "").trim(),
      evidence_url: String(fd.get("evidence_url") ?? "").trim() || null,
      contact_email: String(fd.get("contact_email") ?? "").trim(),
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/legal/dispute`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setResult(legalApiFallback("dispute"));
      setLoading(false);
      return;
    }

    if (res.status === 404 || res.status === 405) {
      setResult(legalApiFallback("dispute"));
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setResult({ error: await res.text() });
      setLoading(false);
      return;
    }

    const data = (await res.json()) as LegalSubmitResult;
    setResult(data);
    setLoading(false);
    e.currentTarget.reset();
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem", fontSize: 13, lineHeight: 1.6 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/legal" style={{ fontSize: 12 }}>
          ← Legal &amp; compliance
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Corrections, disputes &amp; appeals</h1>
      <p style={{ color: "var(--muted)" }}>
        Submit factual corrections or request review of platform output. We cite evidence tiers — we do not label
        counterparties as fraudulent or sanctioned without official list adjudication.
      </p>

      <form onSubmit={submitDispute} style={{ display: "grid", gap: "0.75rem", marginTop: "1.25rem" }}>
        <label style={{ display: "grid", gap: 4 }}>
          request type
          <select name="request_type" required style={inputStyle}>
            {REQUEST_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          entity type (optional)
          <input name="entity_type" placeholder="company, asset, vessel, deal…" style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          entity ID or name (optional)
          <input name="entity_id" placeholder="UUID, MMSI, or dossier name" style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          deal ID (optional)
          <input name="deal_id" placeholder="For deal-pack disputes" style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          field in question (optional)
          <input name="field_in_question" placeholder="e.g. sanctions hit, corridor flag, map geometry" style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          description
          <textarea
            name="description"
            required
            rows={4}
            placeholder="What is incorrect or disputed? Include observed vs inferred context if known."
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          evidence or source link (optional)
          <input
            name="evidence_url"
            type="url"
            placeholder="Registry filing, official list, government GIS, contract excerpt…"
            style={inputStyle}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          contact email
          <input name="contact_email" type="email" required placeholder="you@company.com" style={inputStyle} />
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}
        >
          {loading ? "Submitting…" : "Submit for operator review"}
        </button>
      </form>

      {result && (
        <div style={{ marginTop: "1.5rem" }}>
          {result.error && (
            <p style={{ color: result.fallback ? "var(--warn)" : "#f87171", margin: 0 }}>
              {result.error}
              {result.fallback && (
                <>
                  {" "}
                  <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> ·{" "}
                  <Link href="/admin">Admin console</Link>
                </>
              )}
            </p>
          )}
          {(result.status === "submitted" || result.status === "queued") && (
            <p style={{ margin: 0 }}>
              <span className="badge partial">Queued for operator review</span>
              {result.queue_id && (
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>ref {result.queue_id}</span>
              )}
            </p>
          )}
        </div>
      )}

      <p className="disclaimer">
        Submissions are triaged manually. Turnaround depends on operator capacity. Third-party open-data sources may not
        be amendable by MadSan. Screening hits remain review-tier leads until adjudicated against official lists.
      </p>

      <nav
        style={{
          marginTop: "2rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          display: "flex",
          gap: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <Link href="/legal">Legal hub</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/privacy#gdpr">GDPR rights</Link>
        <Link href="/">Terminal</Link>
      </nav>
    </main>
  );
}
