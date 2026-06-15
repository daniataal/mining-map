"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/layers";

type DataProps = {
  mode: "data";
  entityType: string;
  entityId?: string;
  entityName?: string;
};

type DealProps = {
  mode: "deal";
  dealId: string;
};

type Props = DataProps | DealProps;

const btnStyle: React.CSSProperties = {
  padding: "6px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  borderColor: "var(--accent)",
  color: "var(--accent)",
};

export default function FeedbackFlywheel(props: Props) {
  const [status, setStatus] = useState<"idle" | "submitting" | "queued" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(verdict: "inaccurate" | "real" | "scam") {
    setStatus("submitting");
    setMessage("");

    const body =
      props.mode === "data"
        ? {
            feedback_kind: "data_feedback",
            entity_type: props.entityType,
            entity_id: props.entityId ?? "",
            entity_name: props.entityName ?? "",
            verdict,
          }
        : {
            feedback_kind: "deal_feedback",
            deal_id: props.dealId,
            verdict,
          };

    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setMessage(await res.text());
        return;
      }
      const data = (await res.json()) as { confidence?: string };
      setStatus("queued");
      setMessage(data.confidence ?? "Queued for analyst review.");
    } catch {
      setStatus("error");
      setMessage("Feedback API unreachable — signal not recorded.");
    }
  }

  return (
    <div className="feedback-flywheel">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Improve intelligence
        </strong>
        <span className="badge compact tier-low">Low · review queue</span>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
        Feeds the analyst review queue — not an instant correction.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {props.mode === "data" ? (
          <button
            type="button"
            disabled={status === "submitting" || status === "queued"}
            onClick={() => submit("inaccurate")}
            style={status === "queued" ? btnActiveStyle : btnStyle}
          >
            {status === "submitting" ? "Sending…" : "Flag inaccurate data"}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={status === "submitting" || status === "queued"}
              onClick={() => submit("real")}
              style={status === "queued" ? btnActiveStyle : btnStyle}
            >
              {status === "submitting" ? "Sending…" : "Deal looked real"}
            </button>
            <button
              type="button"
              disabled={status === "submitting" || status === "queued"}
              onClick={() => submit("scam")}
              style={btnStyle}
            >
              Looked like scam
            </button>
          </>
        )}
      </div>
      {status === "queued" && (
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--verified)" }}>{message}</p>
      )}
      {status === "error" && (
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "#f87171" }}>{message}</p>
      )}
    </div>
  );
}
