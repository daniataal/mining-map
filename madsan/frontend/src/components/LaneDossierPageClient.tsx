"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import {
  fetchLaneDossier,
  normalizeEvidenceLabel,
  type DossierGap,
  type DossierSectionItem,
  type LaneDossierSegmentKey,
  type LaneDossierView,
} from "@/lib/energyApi";

type Props = {
  opportunityId: string;
  initialSegment?: LaneDossierSegmentKey;
};

const LANE_SEGMENTS: Array<{ id: LaneDossierSegmentKey; label: string }> = [
  { id: "thesis", label: "Thesis" },
  { id: "chain", label: "Chain" },
  { id: "act", label: "Act" },
  { id: "numbers", label: "Numbers" },
];

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function EvidenceBadge({ label }: { label: string }) {
  const kind = normalizeEvidenceLabel(label);
  return <span className={`evidence-label evidence-label--${kind}`}>{kind}</span>;
}

function CommercialGap({ children }: { children: ReactNode }) {
  return <span className="commercial-gap">{children}</span>;
}

function GapPanel({ title, gaps }: { title: string; gaps: DossierGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="commercial-gap-panel">
      <strong>{title}</strong>
      <div className="commercial-gap-row">
        {gaps.map((gap) => (
          <CommercialGap key={gap.key}>{gap.label}</CommercialGap>
        ))}
      </div>
      {gaps.some((gap) => gap.unlockHint) && (
        <div className="commercial-gap-hints">
          {gaps.map((gap) => (gap.unlockHint ? <p key={`${gap.key}-hint`}>{gap.unlockHint}</p> : null))}
        </div>
      )}
    </div>
  );
}

function LaneIntelCard({ item }: { item: DossierSectionItem }) {
  const href =
    textValue(item.raw?.source_url) ||
    textValue(item.raw?.url) ||
    textValue(item.raw?.website);
  const safeHref = href.startsWith("http") ? href : undefined;
  return (
    <article className="commercial-card lane-segment-card">
      <div className="commercial-card-head">
        <EvidenceBadge label={item.evidenceLabel} />
        {item.meta && <strong>{item.meta}</strong>}
      </div>
      <h3>{item.title}</h3>
      {item.lines.length > 0 && (
        <div className="commercial-card-lines">
          {item.lines.map((line, idx) => (
            <p key={`${item.id}-line-${idx}`}>{line}</p>
          ))}
        </div>
      )}
      {safeHref && (
        <div className="commercial-action-row">
          <a className="commercial-action commercial-action--enabled" href={safeHref} target="_blank" rel="noreferrer">
            Open source
          </a>
        </div>
      )}
    </article>
  );
}

function LaneSegmentPanel({
  segment,
  view,
}: {
  segment: LaneDossierSegmentKey;
  view: LaneDossierView;
}) {
  const tab = view.segments[segment];
  const gapTitle =
    segment === "numbers"
      ? "Margin and market gaps"
      : segment === "act"
        ? "Outreach and verification gaps"
        : segment === "thesis"
          ? "Broker alpha gaps"
          : "Chain gaps";
  return (
    <div className="commercial-tab-panel lane-segment-panel">
      {tab.items.length === 0 ? (
        <div className="commercial-empty">
          <p>No {segment} evidence is attached to this lane yet.</p>
          <p className="commercial-empty-unlock">Synthesis API or linked investor/cargo paths would unlock this segment.</p>
        </div>
      ) : (
        tab.items.map((item) => <LaneIntelCard key={item.id} item={item} />)
      )}
      <GapPanel title={gapTitle} gaps={tab.gaps} />
    </div>
  );
}

export default function LaneDossierPageClient({ opportunityId, initialSegment = "thesis" }: Props) {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LaneDossierView | null>(null);
  const [activeSegment, setActiveSegment] = useState<LaneDossierSegmentKey>(initialSegment);

  useEffect(() => {
    setActiveSegment(initialSegment);
  }, [initialSegment]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLaneDossier(opportunityId)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  const synthesisLabel = useMemo(() => {
    if (!view) return "loading";
    if (view.synthesisStatus === "complete") return "synthesis";
    if (view.synthesisStatus === "partial") return "partial synthesis";
    return "pending synthesis";
  }, [view]);

  return (
    <AppShell maxWidth="full">
      <div className="intel-dossier-page lane-dossier-page">
        <div className="intel-dossier-page-head">
          <div>
            <Link href="/?panel=opportunities" className="intel-dossier-back">
              Broker home
            </Link>
            <h1>{view?.corridor || view?.commodity || "Lane dossier"}</h1>
            <span>lane · {opportunityId}</span>
          </div>
          <div className="intel-dossier-kpis">
            <span>
              <small>score</small>
              <strong>{loading ? "…" : view?.score != null ? Math.round(view.score) : "—"}</strong>
            </span>
            <span>
              <small>status</small>
              <strong>{synthesisLabel}</strong>
            </span>
            <span>
              <small>evidence</small>
              <strong>{loading ? "…" : view?.evidenceGrade ?? "inferred"}</strong>
            </span>
          </div>
        </div>

        {!loading && view && (
          <div className="lane-thesis-hero">
            <EvidenceBadge label={view.evidenceGrade} />
            <p>{view.thesis}</p>
            {view.synthesisStatus !== "complete" && (
              <small className="lane-synthesis-note">
                Synthesis API {view.synthesisStatus === "pending" ? "not available" : "partial"} — showing snapshot-backed
                evidence with honest gaps.
              </small>
            )}
          </div>
        )}

        <section className="commercial-dossier-workspace lane-dossier-workspace">
          <div className="commercial-workspace-head">
            <div>
              <span>Lane intelligence</span>
              <h2>Four-segment dossier</h2>
            </div>
            <strong>
              {loading
                ? "loading"
                : `${Object.values(view?.segments ?? {}).reduce((sum, seg) => sum + seg.count, 0)} linked items`}
            </strong>
          </div>

          <div className="lane-dossier-segments" role="tablist" aria-label="Lane dossier segments">
            {LANE_SEGMENTS.map((segment) => (
              <button
                key={segment.id}
                type="button"
                role="tab"
                aria-selected={activeSegment === segment.id}
                className={`lane-segment-tab${activeSegment === segment.id ? " is-active" : ""}`}
                onClick={() => setActiveSegment(segment.id)}
              >
                {segment.label}
                <em>{loading ? "…" : view?.segments[segment.id].count ?? 0}</em>
              </button>
            ))}
          </div>

          <div className="commercial-tab-content lane-segment-content" role="tabpanel">
            {loading || !view ? (
              <div className="commercial-empty">Loading lane dossier…</div>
            ) : (
              <LaneSegmentPanel segment={activeSegment} view={view} />
            )}
          </div>
        </section>

        {!loading && view && view.limitations.length > 0 && (
          <div className="lane-limitations">
            <strong>Limitations</strong>
            <p>{view.limitations.slice(0, 4).join(" ")}</p>
          </div>
        )}

        <p className="disclaimer">
          Evidence labels separate observed, reported, source-backed, inferred, estimated, and predicted intelligence.
          Numbers segment is indicative scenario context only — not buy, sell, or forecast signals.
        </p>
      </div>
    </AppShell>
  );
}
