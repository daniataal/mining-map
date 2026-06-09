"use client";

type ChangeEntry = {
  field?: string;
  old_value?: string;
  new_value?: string;
  detected_at?: string;
  source?: string;
};

export type DealChanges = {
  deal_id: string;
  tier: string;
  changes: ChangeEntry[];
};

type Props = {
  changes: DealChanges | null;
  error?: string;
};

export default function DealChangesPanel({ changes, error }: Props) {
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

  const tierLabel = changes.tier.replace(/_/g, " ");
  const isNotImplemented = changes.tier === "not_implemented";

  return (
    <div className="deal-changes" style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 13 }}>Pack changes watch</strong>
      <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 10px" }}>
        <span className={`badge ${isNotImplemented ? "partial" : "verified"}`}>
          tier: {tierLabel}
        </span>
        {isNotImplemented && (
          <span style={{ display: "block", marginTop: 6 }}>
            Living pack diff monitoring is not shipped yet — re-verify for a fresh intelligence snapshot.
          </span>
        )}
      </p>
      {changes.changes.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
          No changes recorded for deal {changes.deal_id.slice(0, 8)}…
        </p>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
          {changes.changes.map((c, i) => (
            <li key={`${c.field ?? i}-${i}`}>
              {c.field && <strong>{c.field}: </strong>}
              {c.old_value != null && <span>{c.old_value} → </span>}
              {c.new_value != null && <span>{c.new_value}</span>}
              {c.source && (
                <span style={{ color: "var(--muted)" }}> ({c.source})</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
