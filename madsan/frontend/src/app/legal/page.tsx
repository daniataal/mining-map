import Link from "next/link";

export default function LegalPage() {
  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem", lineHeight: 1.6 }}>
      <p style={{ marginBottom: 8 }}>
        <Link href="/" style={{ fontSize: 12 }}>
          ← Terminal
        </Link>
      </p>
      <h1>Legal &amp; Compliance</h1>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        MadSan Intelligence is a commodity due-diligence terminal. This page describes how to interpret
        platform output — not a substitute for qualified legal, compliance, or trading counsel.
      </p>

      <h2>Intelligence, not advice</h2>
      <p>
        Maps, dossiers, deal verification scores, corridor flags, sanctions screening results, and exported
        packs are <strong>intelligence for human review</strong>. They do not constitute legal, financial,
        tax, compliance, insurance, or trading advice. No score, badge, or &ldquo;verified&rdquo; label
        authorizes a transaction, shipment, payment, or contractual commitment.
      </p>
      <p>
        Operators must apply their own KYC/AML, sanctions, export-control, licensing, and counterparty
        policies before acting on any lead surfaced here.
      </p>

      <h2>Data tiers &amp; evidence</h2>
      <p>
        Claims are labeled by tier where the platform has attribution:
      </p>
      <ul style={{ fontSize: 14, paddingLeft: "1.25rem" }}>
        <li>
          <strong>Observed</strong> — directly sourced (e.g. registry filings, AIS positions, open government
          datasets) with source attribution where available.
        </li>
        <li>
          <strong>Inferred</strong> — derived from observed signals (e.g. vessel–terminal proximity from AIS
          destination, relationship graph edges). Not cargo or title confirmation.
        </li>
        <li>
          <strong>Satellite-derived</strong> — where used, labeled separately; not all assets have satellite
          coverage.
        </li>
      </ul>
      <p>
        Confidence scores summarize evidence depth and risk signals — they are not warranties of accuracy.
        Provider coverage varies by region (e.g. live AIS has limited Persian Gulf / Hormuz observations).
        Missing data is shown honestly; absence of a flag does not mean absence of risk.
      </p>
      <p>
        Reference prices on the ticker may be open-data (e.g. EIA) or stub tiers — check the tier badge and
        tooltip before using in pricing decisions.
      </p>

      <h2>Sanctions screening limits</h2>
      <p>
        Deal verification may query <strong>OpenSanctions</strong> and apply corridor/country watchlists from
        platform configuration. These checks are <strong>review-tier leads</strong>, not confirmed sanctions
        designations or PEP determinations.
      </p>
      <ul style={{ fontSize: 14, paddingLeft: "1.25rem" }}>
        <li>Potential name matches require manual adjudication against official lists (OFAC, EU, UN, etc.).</li>
        <li>Screening may be unavailable when the API is down, rate-limited, or unconfigured.</li>
        <li>Corridor rules reflect configured policy — not an exhaustive sanctions compliance program.</li>
        <li>No automated output clears a counterparty for trade, banking, or shipping.</li>
      </ul>
      <p>
        Exported deal packs repeat these limitations in their disclaimer field. See also{" "}
        <Link href="/deals">Deal verification</Link> for live screening output.
      </p>

      <h2>Privacy</h2>
      <p>
        Account and usage data are processed under GDPR-oriented principles: purpose limitation, retention
        limits, erasure on request, and no sale of personal data. Tenant-scoped data isolation is in
        progress — do not treat the platform as multi-tenant production-hardened until RLS cutover is complete.
      </p>
      <p style={{ fontSize: 14 }}>
        See the <Link href="/legal/privacy">privacy page</Link> for data categories and{" "}
        <Link href="/legal/privacy#gdpr">GDPR rights</Link> (access, erasure, portability).
      </p>

      <h2>Corrections &amp; disputes</h2>
      <p>
        If entity data, map geometry, or a review-tier flag is wrong, submit a correction for operator review.
        Disputes cite evidence — they are not findings of fraud or illegality.
      </p>
      <p style={{ fontSize: 14 }}>
        Use the <Link href="/legal/dispute">corrections &amp; disputes form</Link> or sign in and open the{" "}
        <Link href="/admin">Admin</Link> review queue. For deal-pack disputes, reference the deal ID and the
        specific field in question.
      </p>
      <p>
        Corrections are triaged manually; turnaround depends on operator capacity. We do not guarantee
        immediate removal or amendment of third-party open-data records.
      </p>

      <h2>Risk wording</h2>
      <p>
        Red flags and warnings cite the evidence or rule that triggered them. They are prompts for
        investigation, not findings of fraud or illegality.
      </p>

      <p className="disclaimer" style={{ marginTop: "2rem" }}>
        <strong>No external legal approval.</strong> This copy has not been reviewed or approved by outside
        legal or compliance counsel. It is engineering-authored disclosure for internal and pilot use. Formal
        terms of use, cookie consent, and counsel sign-off are outstanding before public or commercial
        exposure — see the Phase 14 launch checklist.
      </p>
      <p className="disclaimer" style={{ borderTop: 0, paddingTop: 0, marginTop: "0.5rem" }}>
        Last updated: June 2026 · MadSan Intelligence V2 greenfield
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
        <Link href="/legal/dispute">Corrections &amp; disputes</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/privacy#gdpr">GDPR rights</Link>
        <Link href="/">Terminal</Link>
      </nav>
    </main>
  );
}
