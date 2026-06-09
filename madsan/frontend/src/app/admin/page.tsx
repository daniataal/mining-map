"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/layers";

type Insights = {
  entities?: { assets?: number; companies?: number; vessels?: number; vessels_ais_24h?: number };
  provenance?: { sources?: number; evidence_rows?: number; staging_rows?: number };
  ingestion?: { pending?: number; running?: number; completed?: number; failed?: number };
  review_queue_pending?: number;
  dedup?: { company_clusters?: number; extra_rows?: number };
};

type DupCluster = {
  normalized_name: string;
  count: number;
  match_score: number;
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

export default function AdminPage() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [dupClusters, setDupClusters] = useState<DupCluster[]>([]);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/api/admin/insights/summary`).then((r) => r.json()).then(setInsights).catch(() => {});
    fetch(`${API_BASE}/api/admin/ingestion/jobs`).then((r) => r.json()).then(setJobs).catch(() => {});
    fetch(`${API_BASE}/api/admin/sources`).then((r) => r.json()).then(setSources).catch(() => {});
    fetch(`${API_BASE}/api/admin/review-queue`).then((r) => r.json()).then(setQueue).catch(() => {});
    fetch(`${API_BASE}/api/admin/dedup/companies?limit=15`).then((r) => r.json()).then((d) => setDupClusters(d.clusters ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  async function scanDuplicates() {
    setMsg("");
    const res = await fetch(`${API_BASE}/api/admin/dedup/companies/scan?limit=100`, { method: "POST" });
    const data = await res.json();
    setMsg(res.ok ? `Dedup scan: ${data.enqueued} queued for review` : JSON.stringify(data));
    refresh();
  }

  async function resolveQueueItem(queueId: string, action: "merge" | "dismiss", canonicalCompanyId?: string) {
    setMsg("");
    const res = await fetch(`${API_BASE}/api/admin/review-queue/${queueId}/resolve`, {
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

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1rem", fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Admin console</h1>
        <button type="button" onClick={refresh} style={{ padding: "8px 12px", background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)" }}>
          Refresh
        </button>
      </div>

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
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Enqueue ingestion</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 12px" }}>Requires worker running: <code>go run ./cmd/worker</code></p>
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
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Company dedup (SQL pass — Splink next)</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 10px" }}>
          {insights?.dedup?.company_clusters ?? 0} name clusters · {insights?.dedup?.extra_rows ?? 0} extra rows beyond canonical
        </p>
        <button type="button" onClick={scanDuplicates} style={{ padding: 8, background: "var(--panel)", border: "1px solid var(--border)", color: "var(--text)", marginBottom: 12 }}>
          Scan → review queue
        </button>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>normalized_name</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>count</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>score</th>
              <th style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>countries</th>
            </tr>
          </thead>
          <tbody>
            {dupClusters.map((c) => (
              <tr key={c.normalized_name}>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{c.normalized_name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{c.count}</td>
                <td style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>{Math.round(c.match_score)}</td>
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
