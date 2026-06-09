"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/layers";

type Insights = {
  entities?: { assets?: number; companies?: number; vessels?: number; vessels_ais_24h?: number };
  provenance?: { sources?: number; evidence_rows?: number; staging_rows?: number };
  ingestion?: { pending?: number; running?: number; completed?: number; failed?: number };
  review_queue_pending?: number;
  dedup?: { company_clusters?: number; extra_rows?: number };
  config?: { legacy_python_enabled?: boolean };
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
  api_ok?: boolean;
  db_ok?: boolean;
  legacy_db_reachable?: boolean;
  legacy_db_error?: string;
  ais_sync_enabled?: boolean;
  vessels_ais_24h?: number;
  legacy_parity_summary?: {
    available?: boolean;
    passed?: boolean;
    checked_at?: string;
    failed_critical?: string[];
    table_count?: number;
    summary?: string;
    error?: string;
  };
};

type RuntimeHealth = {
  ais_sync?: {
    enabled?: boolean;
    legacy_configured?: boolean;
    interval_sec?: number;
    last_sync_at?: string;
    last_batch_updated?: number;
    last_error?: string | null;
    vessels_total?: number;
    vessels_fresh_24h?: number;
    vessels_fresh_72h?: number;
    coverage_note?: string;
  };
  legacy_parity?: {
    available?: boolean;
    passed?: boolean;
    checked_at?: string;
    threshold_pct?: number;
    cache_ttl_sec?: number;
    failed_critical?: string[];
    tables?: ParityTable[];
    error?: string;
  };
  legacy_python?: boolean;
};

type DupCluster = {
  normalized_name: string;
  count: number;
  match_score: number;
  review_tier?: string;
  members: Array<{ id: string; name: string; country_code?: string }>;
};

type IngestJob = {
  id: string;
  job_type: string;
  source_slug?: string;
  status: string;
  attempts?: number;
  scheduled_at?: string;
  finished_at?: string;
  error_message?: string | null;
  result_report?: { imported?: number; total?: number; evidence_claims?: number };
};

type SourceRow = {
  slug?: string;
  source_name?: string;
  source_type?: string;
  evidence_rows?: number;
  staging_rows?: number;
  reliability_score?: number;
  imported_at?: string;
};

type ReviewQueueItem = {
  id: string;
  entity_type?: string;
  reason: string;
  confidence_score?: number;
  status: string;
  created_at?: string;
  candidate_matches?: Array<{ id: string; name: string; country_code?: string; confidence_score?: number }>;
  raw_payload?: {
    normalized_name?: string;
    member_count?: number;
    review_tier?: string;
    members?: Array<{ id: string; name: string; country_code?: string; confidence_score?: number }>;
  };
};

function suggestedCanonical(members?: Array<{ id: string; confidence_score?: number }>) {
  if (!members?.length) return "";
  let best = members[0];
  for (const m of members.slice(1)) {
    if ((m.confidence_score ?? 0) > (best.confidence_score ?? 0)) best = m;
  }
  return best.id;
}

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  padding: "1rem",
  borderRadius: 4,
};

const fetchOpts: RequestInit = { credentials: "include" };

export default function AdminPage() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [dupClusters, setDupClusters] = useState<DupCluster[]>([]);
  const [msg, setMsg] = useState("");
  const [dedupMsg, setDedupMsg] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState("");
  const [platform, setPlatform] = useState<PlatformHealth | null>(null);
  const [runtime, setRuntime] = useState<RuntimeHealth | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/core/auth/me`, fetchOpts)
      .then((r) => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);

  const refresh = useCallback(() => {
    if (!authed) return;
    fetch(`${API_BASE}/api/admin/insights/summary`, fetchOpts)
      .then((r) => {
        if (r.status === 401) {
          setAuthed(false);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setInsights(d))
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/ingestion/jobs`, fetchOpts)
      .then((r) => (r.ok ? r.json() : []))
      .then(setJobs)
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/sources`, fetchOpts)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSources)
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/review-queue`, fetchOpts)
      .then((r) => (r.ok ? r.json() : []))
      .then(setQueue)
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/dedup/companies?limit=15`, fetchOpts)
      .then((r) => (r.ok ? r.json() : { clusters: [] }))
      .then((d) => setDupClusters(d.clusters ?? []))
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/health`, fetchOpts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPlatform(d))
      .catch(() => {});
    fetch(`${API_BASE}/api/admin/health/runtime`, fetchOpts)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRuntime(d))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [authed, refresh]);

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
      body: JSON.stringify({ email, password, display_name: "Admin user", tenant_slug: "default" }),
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

  async function scanDuplicates() {
    setDedupMsg("");
    const res = await fetch(`${API_BASE}/api/admin/dedup/companies/scan?limit=100`, { ...fetchOpts, method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDedupMsg(typeof data === "string" ? data : data?.error ?? JSON.stringify(data));
      return;
    }
    const total = data.enqueued ?? 0;
    const exact = data.exact_name_enqueued;
    const cross = data.cross_name_enqueued;
    const breakdown =
      exact != null || cross != null
        ? ` (${exact ?? 0} exact-name · ${cross ?? 0} cross-name)`
        : "";
    setDedupMsg(`Dedup scan: ${total} queued for review${breakdown}`);
    refresh();
  }

  async function exportPairsCSV() {
    setDedupMsg("");
    const res = await fetch(`${API_BASE}/api/admin/dedup/companies/pairs.csv?limit=200`, fetchOpts);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      setDedupMsg(errText || `CSV export failed (${res.status})`);
      return;
    }
    const crossRaw = res.headers.get("X-Madsan-Cross-Name-Enqueued");
    const pairCountRaw = res.headers.get("X-Madsan-Pair-Count");
    const crossEnqueued = crossRaw != null && crossRaw !== "" ? Number(crossRaw) : null;
    const pairCount = pairCountRaw != null && pairCountRaw !== "" ? Number(pairCountRaw) : null;
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch?.[1] ?? "company_pairs.csv";
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    const parts = ["Pairs CSV downloaded"];
    if (pairCount != null && !Number.isNaN(pairCount)) parts.push(`${pairCount} rows`);
    if (crossEnqueued != null && !Number.isNaN(crossEnqueued)) {
      parts.push(`${crossEnqueued} cross-name enqueued for review`);
    }
    setDedupMsg(parts.join(" · "));
    refresh();
  }

  async function resolveQueueItem(queueId: string, action: "merge" | "dismiss", canonicalCompanyId?: string) {
    setMsg("");
    const res = await fetch(`${API_BASE}/api/admin/review-queue/${queueId}/resolve`, {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, canonical_company_id: canonicalCompanyId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof data === "string" ? data : data?.error ?? `Resolve failed (${res.status})`);
      return;
    }
    const mergeStats = data.merge as { merged_company_ids?: string[]; assets_updated?: number } | undefined;
    setMsg(
      action === "merge"
        ? `Merged ${mergeStats?.merged_company_ids?.length ?? 0} duplicates → ${canonicalCompanyId} (${mergeStats?.assets_updated ?? 0} asset FK updates)`
        : "Review item dismissed"
    );
    refresh();
  }

  async function enqueue(jobType: string, sourceSlug: string, payload?: Record<string, unknown>) {
    setMsg("");
    const res = await fetch(`${API_BASE}/api/admin/ingestion/enqueue`, {
      ...fetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_type: jobType, source_slug: sourceSlug, payload: payload ?? { trigger: "admin" } }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Job ${data.status}: ${data.job_id}` : String(data));
    refresh();
  }

  const ent = insights?.entities ?? {};
  const prov = insights?.provenance ?? {};
  const ing = insights?.ingestion ?? {};

  if (authed === false) {
    return (
      <main style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
        <h1 style={{ marginTop: 0 }}>Admin console</h1>
        <p style={{ color: "var(--muted)" }}>Sign in to access ingestion, dedup, and review queue tools.</p>
        <form onSubmit={ensureAuth} style={{ display: "grid", gap: "0.75rem", padding: "1rem", background: "var(--panel)", border: "1px solid var(--border)" }}>
          <label style={{ display: "grid", gap: 4 }}>
            email
            <input name="email" type="email" required defaultValue="admin@madsan.dev" style={{ padding: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            password
            <input name="password" type="password" required defaultValue="devpass123" style={{ padding: 8, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </label>
          <button type="submit" style={{ padding: 10, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>Register / sign in</button>
          {authError && <p style={{ color: "#f87171", margin: 0 }}>{authError}</p>}
        </form>
      </main>
    );
  }

  if (authed === null) {
    return (
      <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
        <p style={{ color: "var(--muted)" }}>Checking session…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Admin console</h1>
        <button type="button" onClick={refresh} style={{ padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
          Refresh
        </button>
      </div>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Platform health</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
          Core ops checks: API, database, legacy ETL source, AIS sync, and cached legacy row-count parity (5% threshold).
          Red Parity usually means madsan is under-imported — run <strong>Legacy import (all)</strong> with the worker, not Python fallback.
        </p>
        {platform ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 12 }}>
              {[
                ["API", platform.api_ok === true],
                ["Database", platform.db_ok === true],
                ["Legacy DB", platform.legacy_db_reachable === true],
                ["AIS sync", platform.ais_sync_enabled === true],
                [
                  "Parity",
                  platform.legacy_parity_summary?.available === true && platform.legacy_parity_summary?.passed === true,
                ],
              ].map(([label, ok]) => (
                <div key={String(label)} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 4 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: ok ? "#22c55e" : "#ef4444",
                      flexShrink: 0,
                    }}
                    aria-hidden
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{label}</div>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>{ok ? "ok" : "issue"}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
              <span>Vessels AIS 24h: <strong style={{ color: "var(--text)" }}>{platform.vessels_ais_24h ?? "—"}</strong></span>
              {platform.legacy_parity_summary?.summary && (
                <span>
                  Parity: <strong style={{ color: platform.legacy_parity_summary.passed ? "var(--accent)" : "#f87171" }}>{platform.legacy_parity_summary.summary}</strong>
                </span>
              )}
              {platform.legacy_db_error && platform.legacy_db_reachable !== true && (
                <span style={{ color: "#f87171" }}>Legacy: {platform.legacy_db_error}</span>
              )}
              {platform.legacy_parity_summary?.checked_at && (
                <span>Checked {new Date(platform.legacy_parity_summary.checked_at).toLocaleString()}</span>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>Loading platform health…</p>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: "1.5rem" }}>
        {[
          ["Assets", ent.assets],
          ["Companies", ent.companies],
          ["Vessels", ent.vessels],
          ["AIS 24h", ent.vessels_ais_24h],
          ["Evidence", prov.evidence_rows],
          ["Sources", prov.sources],
          ["Staging", prov.staging_rows],
          ["Jobs pending", ing.pending],
          ["Dup clusters", insights?.dedup?.company_clusters],
          ["Extra cos", insights?.dedup?.extra_rows],
        ].map(([label, val]) => (
          <div key={String(label)} style={card}>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--accent)" }}>{val ?? "—"}</div>
          </div>
        ))}
      </section>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Runtime health</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
          Live AIS sync and legacy-vs-madsan row counts (5m cache, 5% drift threshold). Negative drift = fewer rows in madsan than legacy;
          enqueue full Go import before retiring Python. <code>oil_companies</code> is informational only.
        </p>
        {runtime ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
              {[
                ["AIS sync", runtime.ais_sync?.enabled ? "on" : "off"],
                ["Legacy DB", runtime.ais_sync?.legacy_configured ? "connected" : "missing"],
                ["Last batch", runtime.ais_sync?.last_batch_updated ?? "—"],
                ["Vessels 24h", runtime.ais_sync?.vessels_fresh_24h ?? "—"],
                ["Parity", runtime.legacy_parity?.passed === false ? "DRIFT" : runtime.legacy_parity?.passed ? "ok" : "—"],
              ].map(([label, val]) => (
                <div key={String(label)} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 4 }}>
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
                  <div style={{ fontWeight: 600, color: val === "DRIFT" ? "#f87171" : "var(--accent)" }}>{val}</div>
                </div>
              ))}
            </div>
            {runtime.ais_sync?.last_error && (
              <p style={{ color: "#f87171", margin: "0 0 8px" }}>AIS sync error: {runtime.ais_sync.last_error}</p>
            )}
            {runtime.ais_sync?.coverage_note && (
              <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 12px" }}>{runtime.ais_sync.coverage_note}</p>
            )}
            {runtime.legacy_parity?.error ? (
              <p style={{ color: "#f87171" }}>Parity check: {runtime.legacy_parity.error}</p>
            ) : runtime.legacy_parity?.tables?.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Legacy table</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Madsan target</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Legacy</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Madsan</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Drift %</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runtime.legacy_parity.tables.map((row) => (
                    <tr key={row.legacy_table}>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.legacy_table}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{row.madsan_target}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.legacy_count}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{row.madsan_count}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        {row.drift >= 0 ? "+" : ""}{row.drift} ({row.drift_pct}%)
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                        <span className={`badge ${row.ok ? "verified" : "warn"}`}>
                          {row.ok ? "ok" : row.critical ? "critical drift" : "drift"}
                        </span>
                        {row.note && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 10 }}>{row.note}</span>}
                        {!row.ok && row.critical && row.drift < 0 && (
                          <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 10 }}>under-imported</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "var(--muted)" }}>Parity data unavailable.</p>
            )}
            {runtime.legacy_parity?.checked_at && (
              <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
                Parity checked {new Date(runtime.legacy_parity.checked_at).toLocaleString()} · threshold {runtime.legacy_parity.threshold_pct}%
                {runtime.legacy_parity.failed_critical?.length ? ` · failed: ${runtime.legacy_parity.failed_critical.join(", ")}` : ""}
              </p>
            )}
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>Loading runtime health…</p>
        )}
      </section>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Enqueue ingestion</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>
          Requires worker running: <code>go run ./cmd/worker</code>. Legacy import uses Go by default; Python fallback is opt-in only via{" "}
          <code>MADSAN_LEGACY_PYTHON=true</code> in deploy env.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => enqueue("bunker_seed", "bunker_fuel_suppliers")} style={{ padding: 8, background: "var(--accent)", color: "#000", border: 0, fontWeight: 600 }}>
            Bunker seed
          </button>
          <button type="button" onClick={() => enqueue("watch_folder", "raw_watch")} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Watch folder
          </button>
          <button type="button" onClick={() => enqueue("legacy_import", "legacy_mining_db")} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Legacy import (all)
          </button>
          <button type="button" onClick={() => enqueue("legacy_import", "legacy_mining_db", { tables: ["oil_vessels"], max_rows: 2000 })} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Vessels refresh (Go)
          </button>
          <button type="button" onClick={() => enqueue("legacy_import", "legacy_mining_db", { tables: ["licenses"], max_rows: 5000 })} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Metals licenses (Go)
          </button>
          {insights?.config?.legacy_python_enabled && (
            <button
              type="button"
              onClick={() => enqueue("legacy_import", "legacy_mining_db", { use_python: true, tables: ["oil_vessels"], max_rows: 2000 })}
              style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--warn, #b8860b)", color: "var(--text)" }}
            >
              Legacy import (Python)
            </button>
          )}
        </div>
        {msg && <p style={{ marginTop: 10, color: "var(--muted)" }}>{msg}</p>}
        <p style={{ marginTop: 8, color: "var(--muted)", fontSize: 11 }}>
          Queue: {ing.pending ?? 0} pending · {ing.running ?? 0} running · {ing.completed ?? 0} done · {ing.failed ?? 0} failed
        </p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: 15 }}>Data sources</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Source</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Type</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Evidence</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>Staging</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.slug ?? s.source_name}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{s.source_name ?? s.slug}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{s.source_type}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{s.evidence_rows ?? 0}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{s.staging_rows ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: 15 }}>Recent ingestion jobs</h2>
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
            {jobs.slice(0, 20).map((j) => (
              <tr key={j.id}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{j.job_type}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{j.source_slug}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
                  <span className={`badge ${j.status === "completed" ? "verified" : j.status === "failed" ? "warn" : "partial"}`}>{j.status}</span>
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  {j.result_report
                    ? `${j.result_report.imported ?? 0}/${j.result_report.total ?? 0} · ev ${j.result_report.evidence_claims ?? 0}`
                    : j.error_message ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ ...card, marginBottom: "1.5rem" }}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Company dedup (pairwise SQL clusters + Go scoring)</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 10px" }}>
          {insights?.dedup?.company_clusters ?? 0} name clusters · {insights?.dedup?.extra_rows ?? 0} extra rows beyond canonical
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" onClick={scanDuplicates} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Scan → review queue
          </button>
          <button type="button" onClick={exportPairsCSV} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
            Export pairs CSV (Splink)
          </button>
        </div>
        {dedupMsg && (
          <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 12 }}>
            {dedupMsg}
          </p>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>normalized_name</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>count</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>score</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>tier</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>countries</th>
            </tr>
          </thead>
          <tbody>
            {dupClusters.map((c) => (
              <tr key={c.normalized_name}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{c.normalized_name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{c.count}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{Math.round(c.match_score)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11 }}>
                  {c.review_tier ?? "—"}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  {[...new Set(c.members.map((m) => m.country_code).filter(Boolean))].join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 15 }}>Review queue ({insights?.review_queue_pending ?? 0} pending)</h2>
        {queue.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No pending items. Run dedup scan to enqueue duplicate clusters.</p>
        ) : (
          queue.map((item) => {
            const members = item.raw_payload?.members ?? item.candidate_matches ?? [];
            const isDup = item.reason === "duplicate_company";
            const hint = isDup ? suggestedCanonical(item.raw_payload?.members) : "";
            return (
              <div key={item.id} style={{ ...card, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <div>
                    <strong>{item.reason}</strong>
                    <span style={{ color: "var(--muted)", marginLeft: 8 }}>
                      score {item.confidence_score != null ? Math.round(item.confidence_score) : "—"}
                      {item.raw_payload?.review_tier ? ` · ${item.raw_payload.review_tier}` : ""}
                    </span>
                    {item.raw_payload?.normalized_name && (
                      <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                        {item.raw_payload.normalized_name} · {item.raw_payload.member_count ?? members.length} members
                      </div>
                    )}
                  </div>
                  {isDup && (
                    <button
                      type="button"
                      onClick={() => resolveQueueItem(item.id, "dismiss")}
                      style={{ padding: "6px 10px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap" }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
                {isDup && members.length > 0 ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                        <th style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>Company</th>
                        <th style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>Country</th>
                        <th style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>Conf</th>
                        <th style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                            {m.name}
                            {m.id === hint && <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 10 }}>suggested</span>}
                          </td>
                          <td style={{ padding: 6, borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{m.country_code || "—"}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>{m.confidence_score != null ? Math.round(m.confidence_score) : "—"}</td>
                          <td style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
                            <button
                              type="button"
                              onClick={() => resolveQueueItem(item.id, "merge", m.id)}
                              style={{ padding: "4px 8px", background: "var(--accent)", color: "#000", border: 0, fontWeight: 600, fontSize: 11 }}
                            >
                              Merge as canonical
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <pre style={{ margin: 0, fontSize: 11, color: "var(--muted)", overflow: "auto" }}>{JSON.stringify(item.raw_payload ?? item, null, 2)}</pre>
                )}
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
