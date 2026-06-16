"use client";

import { useState } from "react";
import { authFetchOpts } from "@/lib/auth";
import { apiBase } from "@/lib/layers";

export type DDAssistResult = {
  deal_id?: string;
  tier?: string;
  llm_available?: boolean;
  summary?: string;
  risk_narrative?: string;
  unanswered_questions?: string[];
  document_requests?: string[];
  evidence_citations?: string[];
  limitations?: string[];
  message?: string;
};

type Props = {
  dealId: string | undefined;
  disabled?: boolean;
};

export default function DDCopilotPanel({ dealId, disabled }: Props) {
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DDAssistResult | null>(null);
  const [error, setError] = useState("");

  async function runAssist() {
    if (!dealId) return;
    setLoading(true);
    setError("");
    const res = await fetch(`${apiBase()}/api/deals/${dealId}/dd-assist`, {
      ...authFetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ focus: focus.trim() || undefined }),
    });
    if (!res.ok) {
      setError(await res.text());
      setLoading(false);
      return;
    }
    setResult((await res.json()) as DDAssistResult);
    setLoading(false);
  }

  if (!dealId) return null;

  return (
    <div style={{ marginTop: 16, padding: "1rem", background: "var(--panel)", border: "1px solid var(--border)" }}>
      <strong>AI DD copilot</strong>
      <p style={{ color: "var(--muted)", fontSize: 11, margin: "6px 0 8px" }}>
        Grounded draft from evidence, dd_checks, and sanctions only — tier <code>ai_assisted</code>; not legal clearance.
      </p>
      <label style={{ display: "grid", gap: 4, fontSize: 13, marginBottom: 8 }}>
        Focus (optional)
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="e.g. seller sanctions gaps, missing tank receipts"
          disabled={disabled || loading}
          style={{ padding: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
      </label>
      <button
        type="button"
        onClick={runAssist}
        disabled={disabled || loading}
        style={{ padding: "8px 12px", background: "var(--accent)", color: "#000", border: 0, fontWeight: 600, cursor: "pointer" }}
      >
        {loading ? "Drafting…" : "Draft DD assist"}
      </button>
      {error && <p style={{ color: "#f87171", marginTop: 8 }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          {result.message && !result.summary && (
            <p style={{ color: "var(--warn)" }}>{result.message}</p>
          )}
          {result.tier && (
            <p>
              <span className="badge warn">Tier: {result.tier}</span>
              {result.llm_available === false && " — LLM key not configured"}
            </p>
          )}
          {result.summary && (
            <div style={{ marginTop: 8 }}>
              <strong>Summary</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{result.summary}</p>
            </div>
          )}
          {result.risk_narrative && (
            <div style={{ marginTop: 8 }}>
              <strong>Risk narrative</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{result.risk_narrative}</p>
            </div>
          )}
          {result.unanswered_questions && result.unanswered_questions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Unanswered questions</strong>
              <ul>{result.unanswered_questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          {result.document_requests && result.document_requests.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Document requests</strong>
              <ul>{result.document_requests.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}
          {result.evidence_citations && result.evidence_citations.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Evidence citations</strong>
              <ul>{result.evidence_citations.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {result.limitations && result.limitations.length > 0 && (
            <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
              {result.limitations.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
