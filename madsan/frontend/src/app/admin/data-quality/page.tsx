"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import AuthGate, { AuthLoading } from "@/components/auth/AuthGate";
import { useAuth } from "@/contexts/AuthContext";
import { authFetchOpts } from "@/lib/auth";
import { canUse, FEATURE } from "@/lib/entitlements";
import { API_BASE } from "@/lib/layers";

type Insights = {
  entities?: { assets?: number; companies?: number; vessels?: number; vessels_ais_24h?: number };
  provenance?: { sources?: number; evidence_rows?: number; staging_rows?: number };
  ingestion?: { pending?: number; running?: number; completed?: number; failed?: number };
  data_quality?: {
    assets?: { verified?: number; partial?: number; unverified?: number };
    companies?: { verified?: number; partial?: number; unverified?: number };
  };
};

type ParityTable = {
  legacy_table: string;
  madsan_target: string;
  legacy_count: number;
  madsan_count: number;
  drift: number;
  drift_pct: number;
  critical: boolean;
  ok: boolean;
  note?: string;
};

type PlatformHealth = {
  legacy_parity_summary?: {
    available?: boolean;
    passed?: boolean;
    checked_at?: string;
    failed_critical?: string[];
    summary?: string;
    error?: string;
  };
};

type IngestJob = {
  id: string;
  job_type: string;
  source_slug?: string;
  status: string;
  finished_at?: string;
  error_message?: string | null;
  result_report?: Record<string, unknown>;
};

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  padding: "1rem",
  borderRadius: 4,
};

const fetchOpts = authFetchOpts;

export default function DataQualityPage() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [platform, setPlatform] = useState<PlatformHealth | null>(null);
  const [parityTables, setParityTables] = useState<ParityTable[]>([]);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const { me, loading: authLoading, authed } = useAuth();
  const canUseAdmin = canUse(me, FEATURE.apiAccess);

  const refresh = useCallback(() => {
    if (!authed || !canUseAdmin) return;
    fetch(`${API_BASE}/api/admin/insights/summary`, fetchOpts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInsights(d));
    fetch(`${API_BASE}/api/admin/health`, fetchOpts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPlatform(d));
    fetch(`${API_BASE}/api/admin/health/runtime`, fetchOpts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setParityTables(d?.legacy_parity?.tables ?? []));
    fetch(`${API_BASE}/api/admin/ingestion/jobs`, fetchOpts)
      .then((r) => (r.ok ? r.json() : []))
      .then(setJobs);
  }, [authed, canUseAdmin]);

  useEffect(() => {
    if (!authed || !canUseAdmin) return;
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [authed, canUseAdmin, refresh]);

  if (authLoading) {
    return (
      <AppShell>
        <AuthLoading />
      </AppShell>
    );
  }

  if (!authed) {
    return (
      <AppShell>
        <h1 style={{ marginTop: 0 }}>Data quality</h1>
        <AuthGate title="Sign in to view data quality" subtitle="Admin API access required." />
      </AppShell>
    );
  }

  if (!canUseAdmin) {
    return (
      <AppShell>
        <h1 style={{ marginTop: 0 }}>Data quality</h1>
        <p style={{ color: "var(--warn)" }}>Your plan does not include admin API access.</p>
        <Link href="/admin" style={{ fontSize: 12 }}>← Admin console</Link>
      </AppShell>
    );
  }

  const ent = insights?.entities ?? {};
  const dq = insights?.data_quality ?? {};
  const ing = insights?.ingestion ?? {};
  const parity = platform?.legacy_parity_summary ?? {};

  return (
    <AppShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Data quality</h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0" }}>
            Entity coverage, legacy parity, and ingestion health — read-only dashboard.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin" style={{ padding: "8px 12px", border: "1px solid var(--border)", color: "var(--text)", textDecoration: "none" }}>
            Admin console
          </Link>
          <button type="button" onClick={refresh} style={{ padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Refresh
          </button>
        </div>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: "1.5rem" }}>
        {[
          ["Assets", ent.assets],
          ["Companies", ent.companies],
          ["Vessels", ent.vessels],
          ["Evidence", insights?.provenance?.evidence_rows],
          ["Sources", insights?.provenance?.sources],
        ].map(([label, val]) => (
          <div key={String(label)} style={card}>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--accent)" }}>{val ?? "—"}</div>
          </div>
        ))}
      </section>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Quality status breakdown</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {(["assets", "companies"] as const).map((kind) => {
            const row = dq[kind] ?? {};
            const total = (row.verified ?? 0) + (row.partial ?? 0) + (row.unverified ?? 0);
            return (
              <div key={kind}>
                <div style={{ fontWeight: 600, marginBottom: 8, textTransform: "capitalize" }}>{kind}</div>
                <div style={{ fontSize: 12, display: "grid", gap: 4 }}>
                  <span><span className="badge verified">verified</span> {row.verified ?? 0}</span>
                  <span><span className="badge partial">partial</span> {row.partial ?? 0}</span>
                  <span><span className="badge warn">unverified</span> {row.unverified ?? 0}</span>
                  <span style={{ color: "var(--muted)", marginTop: 4 }}>total {total || "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Legacy parity summary</h2>
        {parity.available === false ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>{parity.error ?? "Parity check unavailable"}</p>
        ) : (
          <>
            <p style={{ margin: "0 0 12px" }}>
              <span className={`badge ${parity.passed ? "verified" : "warn"}`}>
                {parity.passed ? "within threshold" : "drift detected"}
              </span>
              {parity.summary && <span style={{ marginLeft: 8 }}>{parity.summary}</span>}
            </p>
            {parityTables.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Legacy</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Madsan</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Legacy cnt</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Madsan cnt</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Drift</th>
                  </tr>
                </thead>
                <tbody>
                  {parityTables.map((row) => (
                    <tr key={row.legacy_table}>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.legacy_table}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{row.madsan_target}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.legacy_count}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.madsan_count}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        <span className={`badge ${row.ok ? "verified" : "warn"}`}>
                          {row.drift_pct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {parity.checked_at && (
              <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8, marginBottom: 0 }}>
                Checked {new Date(parity.checked_at).toLocaleString()}
              </p>
            )}
          </>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Ingestion jobs</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
          {ing.pending ?? 0} pending · {ing.running ?? 0} running · {ing.completed ?? 0} completed · {ing.failed ?? 0} failed
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Type</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Source</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Status</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 15).map((j) => (
              <tr key={j.id}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{j.job_type}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{j.source_slug}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                  <span className={`badge ${j.status === "completed" ? "verified" : j.status === "failed" ? "warn" : "partial"}`}>
                    {j.status}
                  </span>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  {j.result_report ? JSON.stringify(j.result_report) : j.error_message ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
