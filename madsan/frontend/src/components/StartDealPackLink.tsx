"use client";

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { buildDealPackHref, dealPackPrefillFromEntity } from "@/lib/dealPackNav";
import type { CoreDossier } from "@/lib/dossier";
import type { MapSelection } from "./EntityDossierPanel";

type Props = {
  dossier?: CoreDossier | null;
  selection?: MapSelection | null;
  vertical?: "energy" | "metals";
  className?: string;
};

export default function StartDealPackLink({
  dossier = null,
  selection = null,
  vertical = "energy",
  className = "panel-btn",
}: Props) {
  if (!dossier && !selection) return null;
  const prefill = dealPackPrefillFromEntity(dossier, selection, vertical);
  if (!prefill.seller && !prefill.claimed_vessel_mmsi && !prefill.claimed_asset_id) return null;

  const href = buildDealPackHref(prefill, vertical);
  const hint = [
    prefill.commodity,
    prefill.location,
    prefill.claimed_vessel_mmsi ? `MMSI ${prefill.claimed_vessel_mmsi}` : null,
    prefill.claimed_asset_id ? "linked asset" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="deal-pack-cta">
      <Link href={href} className={className} title="Pre-fill deal verification with this entity">
        <Briefcase size={12} style={{ display: "inline", marginRight: 5, verticalAlign: "-2px" }} />
        Start deal pack
      </Link>
      {hint ? (
        <p className="deal-pack-cta-hint">
          Pre-fills {hint}. Supply-web graph attaches when you verify.
        </p>
      ) : (
        <p className="deal-pack-cta-hint">Supply-web graph attaches when you verify.</p>
      )}
    </div>
  );
}
