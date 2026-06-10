"use client";

import { useEffect, useState } from "react";
import {
  fetchMCRStatus,
  fetchUnknownSupplierLeads,
  type MCRScaffoldStatus,
  type UnknownSupplierLead,
} from "@/lib/energyApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MapSelection } from "./EntityDossierPanel";

type Props = {
  onSelectLead?: (sel: MapSelection) => void;
};

function LeadCard({ lead, onClick }: { lead: UnknownSupplierLead; onClick?: () => void }) {
  const label = lead.corridor_label ?? [lead.country_code, lead.commodity].filter(Boolean).join(" · ");
  return (
    <button type="button" className="intel-card intel-card-btn" onClick={onClick}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span className="badge partial compact">inferred</span>
        {lead.gap_score != null && (
          <span className="badge compact tier-mid">score {Math.round(lead.gap_score)}</span>
        )}
      </div>
      <strong style={{ display: "block", marginTop: 4, fontSize: 12 }}>{label || "Corridor gap"}</strong>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
        {lead.asset_count != null ? `${lead.asset_count} assets without linked supplier` : lead.message}
      </p>
    </button>
  );
}

export default function LiveIntelPanel({ onSelectLead }: Props) {
  const [tab, setTab] = useState("opportunities");
  const [leads, setLeads] = useState<UnknownSupplierLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [mcr, setMcr] = useState<MCRScaffoldStatus | null>(null);

  useEffect(() => {
    setLeadsLoading(true);
    fetchUnknownSupplierLeads(15)
      .then(setLeads)
      .finally(() => setLeadsLoading(false));
    fetchMCRStatus().then(setMcr);
  }, []);

  return (
    <div className="live-intel-panel">
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 0 }}>
        Live intelligence feed from madsan Go APIs. Inferred tiers — verify before outreach.
      </p>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="cargo">Cargo / MCR</TabsTrigger>
          <TabsTrigger value="companies">Gaps</TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities">
          {leadsLoading && <p style={{ fontSize: 11, color: "var(--muted)" }}>Loading corridor gaps…</p>}
          {!leadsLoading && leads.length === 0 && (
            <p className="disclaimer" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              No ranked opportunities — petroleum assets need operator gaps for lead scoring.
            </p>
          )}
          <div className="intel-card-stack">
            {leads.map((lead, i) => (
              <LeadCard
                key={`${lead.country_code}-${lead.commodity}-${i}`}
                lead={lead}
                onClick={() =>
                  onSelectLead?.({
                    name: lead.corridor_label ?? `Gap: ${lead.country_code ?? "?"}`,
                    _entityType: "company",
                    country_code: lead.country_code,
                  })
                }
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cargo">
          {mcr ? (
            <div className="intel-card">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="badge partial compact">{mcr.tier}</span>
                <span className="badge tier-none compact">{mcr.status}</span>
              </div>
              <p style={{ margin: "8px 0", fontSize: 12 }}>{mcr.message}</p>
              {mcr.limitations && mcr.limitations.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: "var(--muted)" }}>
                  {mcr.limitations.slice(0, 4).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p style={{ fontSize: 11, color: "var(--muted)" }}>MCR scaffold status unavailable.</p>
          )}
          <p className="disclaimer" style={{ marginTop: 12 }}>
            Cargo list populates when synthetic BOL worker (Phase B) writes cargo_estimates. Select a vessel → MCR tab
            for per-vessel signal history.
          </p>
        </TabsContent>

        <TabsContent value="companies">
          <p style={{ fontSize: 11, color: "var(--muted)" }}>
            Supplier discovery search is on the Suppliers rail. Unknown-supplier leads above rank corridors where
            terminals exist but no counterparty is linked.
          </p>
          <div className="intel-card-stack" style={{ marginTop: 8 }}>
            {leads.slice(0, 8).map((lead, i) => (
              <LeadCard key={`gap-${i}`} lead={lead} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
