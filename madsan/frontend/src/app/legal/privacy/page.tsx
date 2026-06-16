"use client";

import Link from "next/link";
import { useState } from "react";
import { apiBase } from "@/lib/layers";
import {
  LEGAL_CONTACT_EMAIL,
  fetchOpts,
  inputStyle,
  legalApiFallback,
  type LegalSubmitResult,
} from "@/lib/legalForm";

export default function LegalPrivacyPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LegalSubmitResult | null>(null);

  async function submitErasure(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      request_type: "erasure",
      contact_email: String(fd.get("contact_email") ?? "").trim(),
      account_email: String(fd.get("account_email") ?? "").trim() || null,
      scope: String(fd.get("scope") ?? "").trim(),
      notes: String(fd.get("notes") ?? "").trim() || null,
    };

    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/legal/privacy/erasure`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setResult(legalApiFallback("privacy erasure"));
      setLoading(false);
      return;
    }

    if (res.status === 404 || res.status === 405) {
      setResult(legalApiFallback("privacy erasure"));
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
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", lineHeight: 1.6 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/legal" style={{ fontSize: 12 }}>
          ← Legal &amp; compliance
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Privacy</h1>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        MadSan Intelligence processes account, usage, and submission data to operate the commodity due-diligence
        terminal. This page describes pilot-stage privacy practices — not a final privacy policy.
      </p>

      <h2>What we process</h2>
      <ul style={{ fontSize: 14, paddingLeft: "1.25rem" }}>
        <li>
          <strong>Account data</strong> — email, display name, tenant membership, authentication events.
        </li>
        <li>
          <strong>Usage data</strong> — feature access, search and dossier views where logged for entitlements and
          audit.
        </li>
        <li>
          <strong>Submissions</strong> — supplier offers, corrections, disputes, and feedback you send through
          platform forms.
        </li>
        <li>
          <strong>Intelligence data</strong> — commodity entities, map features, and evidence chains sourced from
          open datasets; not personal data unless you supply it in a submission.
        </li>
      </ul>
      <p style={{ fontSize: 14 }}>
        We do not sell personal data. Retention follows purpose limitation; tenant-scoped isolation is in progress
        (RLS cutover outstanding). Do not treat multi-tenant production hardening as complete until Phase 12d
        cutover is done.
      </p>

      <section id="gdpr" style={{ scrollMarginTop: "2rem" }}>
        <h2>GDPR-oriented rights</h2>
        <p style={{ fontSize: 14 }}>
          Where GDPR applies, data subjects may request the following. Responses are manual during the pilot — allow
          reasonable verification time.
        </p>
        <ul style={{ fontSize: 14, paddingLeft: "1.25rem" }}>
          <li>
            <strong>Access</strong> — receive a copy of personal data we hold about you.
          </li>
          <li>
            <strong>Rectification</strong> — correct inaccurate account or submission data.
          </li>
          <li>
            <strong>Erasure</strong> — delete account-linked personal data where no overriding legal basis applies.
          </li>
          <li>
            <strong>Restriction</strong> — limit processing while a dispute is reviewed.
          </li>
          <li>
            <strong>Portability</strong> — export structured account data where technically feasible.
          </li>
          <li>
            <strong>Objection</strong> — object to processing based on legitimate interests (assessed case by case).
          </li>
        </ul>
        <p style={{ fontSize: 14 }}>
          For access or portability requests without a form below, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=GDPR%20access%20request`}>{LEGAL_CONTACT_EMAIL}</a> from
          your registered address.
        </p>

        <h3 style={{ fontSize: 15, marginTop: "1.5rem" }}>Erasure request</h3>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Submit an erasure request for account-linked data. Open-data intelligence records about legal entities are
          generally outside erasure scope when sourced from public registries.
        </p>

        <form
          onSubmit={submitErasure}
          style={{ display: "grid", gap: "0.75rem", marginTop: "1rem", maxWidth: 640, fontSize: 13 }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            your contact email
            <input name="contact_email" type="email" required placeholder="you@company.com" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            registered account email (if different)
            <input name="account_email" type="email" placeholder="account@madsan.dev" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            data to erase
            <select name="scope" required style={inputStyle}>
              <option value="account">Full account and usage history</option>
              <option value="submissions">My portal / dispute submissions only</option>
              <option value="feedback">Feedback events only</option>
              <option value="other">Other — describe in notes</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            notes (optional)
            <textarea
              name="notes"
              rows={3}
              placeholder="Tenant slug, approximate signup date, or other identifiers…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}
          >
            {loading ? "Submitting…" : "Submit erasure request"}
          </button>
        </form>

        {result && (
          <div style={{ marginTop: "1rem", maxWidth: 640 }}>
            {result.error && (
              <p style={{ color: result.fallback ? "var(--warn)" : "#f87171", margin: 0, fontSize: 13 }}>
                {result.error}
                {result.fallback && (
                  <>
                    {" "}
                    <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=GDPR%20erasure%20request`}>
                      {LEGAL_CONTACT_EMAIL}
                    </a>
                  </>
                )}
              </p>
            )}
            {(result.status === "submitted" || result.status === "queued") && (
              <p style={{ margin: 0, fontSize: 13 }}>
                <span className="badge partial">Request recorded — operator will verify identity</span>
              </p>
            )}
          </div>
        )}
      </section>

      <p className="disclaimer">
        <strong>No external legal approval.</strong> Privacy copy is engineering-authored for pilot use. Formal privacy
        policy, cookie consent, and DPA templates require counsel sign-off before commercial exposure.
      </p>

      <nav
        style={{
          marginTop: "1.5rem",
          paddingTop: "1rem",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          display: "flex",
          gap: "1.25rem",
          flexWrap: "wrap",
        }}
      >
        <Link href="/legal">Legal hub</Link>
        <Link href="/legal/dispute">Corrections &amp; disputes</Link>
        <Link href="/legal/privacy#gdpr">GDPR rights</Link>
        <Link href="/">Terminal</Link>
      </nav>
    </main>
  );
}
