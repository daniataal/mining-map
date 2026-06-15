"use client";

type ChangeEntry = {
  type?: string;
  field?: string;
  old_value?: string;
  new_value?: string;
  delta_pct?: number;
  tier?: string;
  source?: string;
  message?: string;
  detected_at?: string;
};

export type DealChanges = {
  deal_id: string;
  tier: string;
  changes: ChangeEntry[];
  watching?: boolean;
  snapshot_at?: string;
};

type Props = {
  changes: DealChanges | null;
  error?: string;
  onWatch?: () => void;
  onUnwatch?: () => void;
  watchBusy?: boolean;
};

function tierBadgeClass(tier?: string): string {
  if (tier === "observed") return "verified";
  return "partial";
}

function formatTier(tier?: string): string {
  return (tier ?? "not_implemented").replace(/_/g, " ");
}

export default function DealChangesPanel({ changes, error, onWatch, onUnwatch, watchBusy }: Props) {
  if (error) {
    return (
      <p style={{ color: "#f87171", fontSize: 12, marginTop: 12 }}>
        {error}
      </p>
    );
  }

  if (!changes) {
    return null;
  }

  const overallTier = changes.tier.replace(/_/g, " ");
  const isNotImplemented = changes.tier === "not_implemented";

  return (
    <div className="deal-changes" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>Pack changes watch</strong>
        {changes.deal_id && onWatch && onUnwatch && (
          <button
            type="button"
            disabled={watchBusy}
            onClick={changes.watching ? onUnwatch : onWatch}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              color: changes.watching ? "var(--warn)" : "var(--accent)",
              cursor: watchBusy ? "wait" : "pointer",
            }}
          >
            {watchBusy ? "…" : changes.watching ? "Unwatch" : "Watch deal"}
          </button>
        )}
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 10px" }}>
        <span className={`badge ${isNotImplemented ? "partial" : "verified"}`}>
          overall: {overallTier}
        </span>
        {changes.snapshot_at && (
          <span style={{ marginLeft: 8 }}>baseline {new Date(changes.snapshot_at).toLocaleString()}</span>
        )}
        {!changes.watching && (
          <span style={{ display: "block", marginTop: 6 }}>
            Watch this deal to capture a pack hash baseline and enable change detection.
          </span>
        )}
      </p>
      {changes.changes.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          {changes.watching ? "No change items yet — baseline captured" : "No changes — watch to start monitoring"}
        </p>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", fontSize: 12 }}>
          {changes.changes.map((c, i) => (
            <li
              key={`${c.type ?? c.field ?? i}-${i}`}
              style={{
                marginBottom: 8,
                padding: "8px 10px",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {c.type && (
                  <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" }}>
                    {c.type.replace(/_/g, " ")}
                  </span>
                )}
                <span className={`badge ${tierBadgeClass(c.tier)}`}>{formatTier(c.tier)}</span>
                {c.source && (
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{c.source}</span>
                )}
              </div>
              {c.field && <div><strong>{c.field}</strong></div>}
              {(c.old_value != null || c.new_value != null) && (
                <div style={{ marginTop: 2 }}>
                  {c.old_value != null && <span>{c.old_value}</span>}
                  {c.old_value != null && c.new_value != null && <span> → </span>}
                  {c.new_value != null && <span>{c.new_value}</span>}
                </div>
              )}
              {c.delta_pct != null && (
                <div style={{ marginTop: 2, color: c.delta_pct >= 0 ? "var(--verified)" : "var(--danger)" }}>
                  Δ {c.delta_pct >= 0 ? "+" : ""}{c.delta_pct.toFixed(2)}%
                </div>
              )}
              {c.message && (
                <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 11 }}>{c.message}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
