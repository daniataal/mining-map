"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authFetchOpts, clearLegacyAuthTokens } from "@/lib/auth";
import { API_BASE } from "@/lib/layers";

const fetchOpts = authFetchOpts;

type SubmitResult = {
  status?: string;
  confidence?: string;
  error?: string;
  fallback?: boolean;
};

const inputStyle: React.CSSProperties = {
  padding: 8,
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export default function PortalPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [docPlaceholder, setDocPlaceholder] = useState("");

  useEffect(() => {
    clearLegacyAuthTokens();
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
      body: JSON.stringify({ email, password, display_name: "Supplier user", tenant_slug: "default" }),
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

  async function submitOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const companyName = String(fd.get("company_name") ?? "").trim();
    const commodity = String(fd.get("commodity") ?? "").trim();
    const notes = String(fd.get("notes") ?? "").trim();
    const docNote = docPlaceholder ? `documents_placeholder: ${docPlaceholder}` : "documents_placeholder: none selected";
    const combinedNotes = [notes, docNote].filter(Boolean).join(" · ");

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/portal/offers`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          commodity,
          notes: combinedNotes,
        }),
      });
    } catch {
      setResult({
        fallback: true,
        error:
          "Supplier portal API is unreachable. Ask an analyst to enqueue your offer via Admin → review queue (manual_review_queue).",
      });
      setLoading(false);
      return;
    }

    if (res.status === 401) {
      setAuthed(false);
      setResult({ error: "Session expired — sign in again." });
      setLoading(false);
      return;
    }

    if (res.status === 404 || res.status === 405) {
      setResult({
        fallback: true,
        error:
          "Supplier portal submit API is not deployed yet. Submit via Admin console enqueue or ask ops to add a manual_review_queue row.",
      });
      setLoading(false);
      return;
    }

    if (!res.ok) {
      setResult({ error: await res.text() });
      setLoading(false);
      return;
    }

    const data = (await res.json()) as SubmitResult;
    setResult(data);
    setLoading(false);
    e.currentTarget.reset();
    setDocPlaceholder("");
  }

  if (authed === null) {
    return (
      <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
        <p style={{ color: "var(--muted)" }}>Checking session…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/" style={{ fontSize: 12 }}>
          ← Terminal
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Supplier portal</h1>
      <p style={{ color: "var(--muted)" }}>
        Submit commodity offers for analyst review. Submissions enqueue{" "}
        <code style={{ fontSize: 11 }}>manual_review_queue</code> with low confidence until verified.
      </p>

      {authed === false && (
        <form
          onSubmit={ensureAuth}
          style={{
            display: "grid",
            gap: "0.75rem",
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "var(--panel)",
            border: "1px solid var(--border)",
          }}
        >
          <strong>Sign in to submit offers</strong>
          <label style={{ display: "grid", gap: 4 }}>
            email
            <input
              name="email"
              type="email"
              required
              defaultValue="supplier@madsan.dev"
              style={{ ...inputStyle, background: "var(--bg)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            password
            <input
              name="password"
              type="password"
              required
              defaultValue="devpass123"
              style={{ ...inputStyle, background: "var(--bg)" }}
            />
          </label>
          <button type="submit" style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>
            Register / sign in
          </button>
          {authError && <p style={{ color: "#f87171", margin: 0 }}>{authError}</p>}
        </form>
      )}

      {authed && (
        <form onSubmit={submitOffer} style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: 4 }}>
            company name
            <input name="company_name" required placeholder="Acme Trading FZE" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            commodity
            <input name="commodity" required placeholder="VLSFO, EN590, gold concentrate…" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            supporting documents
            <input
              type="file"
              multiple
              disabled
              onChange={(ev) => {
                const names = Array.from(ev.target.files ?? [])
                  .map((f) => f.name)
                  .join(", ");
                setDocPlaceholder(names);
              }}
              style={{ ...inputStyle, opacity: 0.6, cursor: "not-allowed" }}
            />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Upload placeholder — file storage not wired yet. Note filenames in notes or email docs to your analyst;
              submission still enqueues manual review without attachments.
            </span>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            notes (optional)
            <textarea
              name="notes"
              rows={3}
              placeholder="Quantity, location, incoterm, contact…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}
          >
            {loading ? "Submitting…" : "Submit for review"}
          </button>
        </form>
      )}

      {result && (
        <div style={{ marginTop: "1.5rem" }}>
          {result.error && (
            <p style={{ color: result.fallback ? "var(--warn)" : "#f87171" }}>
              {result.error}
              {result.fallback && (
                <>
                  {" "}
                  <Link href="/admin">Admin console</Link>
                </>
              )}
            </p>
          )}
          {result.status === "submitted" && (
            <p>
              <span className="badge partial">Queued for analyst review</span>
              {result.confidence && (
                <span style={{ color: "var(--muted)", marginLeft: 8 }}>{result.confidence}</span>
              )}
            </p>
          )}
        </div>
      )}

      <p className="disclaimer">
        Supplier submissions are intelligence signals, not verified listings. Analysts resolve items in the admin review
        queue before dossier promotion.
      </p>
    </main>
  );
}
