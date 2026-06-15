"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, CircleDollarSign, Gauge, Route, Ship, Waves } from "lucide-react";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchIntelArbitrage,
  fetchIntelCargoMovements,
  fetchIntelImporters,
  fetchIntelInvestorPaths,
  fetchIntelOpportunities,
  fetchIntelSTSPredictions,
  type IntelArbitrage,
  type IntelCargoMovement,
  type IntelImporter,
  type IntelInvestorPath,
  type IntelOpportunity,
  type IntelSTSPrediction,
} from "@/lib/energyApi";

type ScoreBreakdown = NonNullable<IntelOpportunity["score_breakdown"]>;
type MapPoint = { lat: number; lng: number };
type ChainMapPayload = { features: FeatureCollection; focus?: MapPoint | null };
type ChainPoint = MapPoint & {
  id: string;
  name: string;
  role: string;
  shortLabel: string;
  evidenceLabel: string;
};
type OpportunityOriginatorPanelProps = {
  onChainFocus?: (features: FeatureCollection, focus?: MapPoint | null) => void;
  onClearChainFocus?: () => void;
};

function fmtScore(value?: number): string {
  if (value == null || Number.isNaN(value)) return "0";
  return Math.round(value).toLocaleString();
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function coordinateFromRecord(value?: Record<string, unknown>): MapPoint | undefined {
  if (!value) return undefined;
  const nested = recordValue(value.coordinates);
  const lat = numberValue(nested?.latitude) ?? numberValue(nested?.lat) ?? numberValue(value.latitude) ?? numberValue(value.lat);
  const lng =
    numberValue(nested?.longitude) ??
    numberValue(nested?.lng) ??
    numberValue(nested?.lon) ??
    numberValue(value.longitude) ??
    numberValue(value.lng) ??
    numberValue(value.lon);
  if (lat == null || lng == null) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

function chainRole(value: string): string {
  switch (value) {
    case "supplier_asset":
    case "source_asset":
      return "supplier_asset";
    case "buyer_asset":
    case "demand_asset":
      return "buyer_asset";
    case "physical_route":
    case "route_or_terminal_access":
      return "physical_route";
    case "cargo_or_vessel":
    case "movement_clue":
      return "cargo_or_vessel";
    default:
      return value || "chain_point";
  }
}

function pointFeature(point: ChainPoint, extra: Record<string, unknown> = {}): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    properties: {
      rel: "opportunity_chain",
      role: point.role,
      name: point.name,
      short_label: point.shortLabel,
      evidence_label: point.evidenceLabel,
      ...extra,
    },
  };
}

function lineFeature(id: string, points: ChainPoint[], extra: Record<string, unknown> = {}): Feature<LineString> | null {
  if (points.length < 2) return null;
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) },
    properties: {
      id,
      rel: "opportunity_chain",
      role: "commercial_chain",
      geometry_source: "opportunity_originator",
      name: points.map((point) => point.name).filter(Boolean).join(" -> "),
      short_label: "Opportunity chain",
      evidence_label: "inferred",
      ...extra,
    },
  };
}

function investorPathMapPayload(item: IntelInvestorPath): ChainMapPayload {
  const investor = item.investor?.name || "reported investor";
  const chain = investorChainNodes(item);
  const points: ChainPoint[] = chain.flatMap((node, idx) => {
    const coord = coordinateFromRecord(node);
    if (!coord) return [];
    const step = textValue(node.step);
    const role = chainRole(textValue(node.role) || step);
    return [{
      id: `${item.id}-${step || idx}`,
      lat: coord.lat,
      lng: coord.lng,
      role,
      name: textValue(node.label) || textValue(node.asset) || chainStepName(node),
      shortLabel: textValue(node.short_label) || chainStepName(node),
      evidenceLabel: textValue(node.evidence_label) || "inferred",
    }];
  });
  const features: Array<Feature<Point> | Feature<LineString>> = points.map((point) =>
    pointFeature(point, {
      chain_kind: "investor_control_path",
      investor,
      commodity: item.commodity ?? "oil/gas",
      origin_country: item.origin_country ?? "",
      destination_country: item.destination_country ?? "",
    }),
  );
  const line = lineFeature(`investor-chain-${item.id}`, points, {
    geometry_source: "investor_control_path",
    chain_kind: "investor_control_path",
    investor,
    commodity: item.commodity ?? "oil/gas",
    origin_country: item.origin_country ?? "",
    destination_country: item.destination_country ?? "",
  });
  if (line) features.unshift(line);
  return {
    features: { type: "FeatureCollection", features },
    focus: points[0] ? { lat: points[0].lat, lng: points[0].lng } : null,
  };
}

function cargoMapPayload(item: IntelCargoMovement): ChainMapPayload {
  const chain = item.commercial_chain ?? {};
  const route = recordValue(chain.route);
  const buyerIntel = recordValue(chain.destination_buyer_intel);
  const decoded = recordValue(item.route_hint?.decoded_destination) ?? recordValue(route?.decoded_destination);
  const buyerAsset = recordArray(buyerIntel?.likely_assets).find((asset) => coordinateFromRecord(asset));
  const points: ChainPoint[] = [];
  const destinationPoint = coordinateFromRecord(decoded);
  if (destinationPoint) {
    points.push({
      id: `${item.id}-ais-destination`,
      lat: destinationPoint.lat,
      lng: destinationPoint.lng,
      role: "cargo_or_vessel",
      name: decodedDestinationLabel(decoded) || item.route_hint?.latest_destination || "AIS destination",
      shortLabel: "AIS destination",
      evidenceLabel: textValue(decoded?.evidence_label) || "inferred",
    });
  }
  const buyerPoint = coordinateFromRecord(buyerAsset);
  if (buyerAsset && buyerPoint) {
    points.push({
      id: `${item.id}-buyer-asset`,
      lat: buyerPoint.lat,
      lng: buyerPoint.lng,
      role: "buyer_asset",
      name: textValue(buyerAsset.asset_name) || textValue(buyerAsset.operator_name) || "likely buyer asset",
      shortLabel: "Buyer asset",
      evidenceLabel: textValue(buyerAsset.evidence_label) || "reported",
    });
  }
  const features: Array<Feature<Point> | Feature<LineString>> = points.map((point) =>
    pointFeature(point, {
      chain_kind: "cargo_destination_buyer_graph",
      vessel_name: item.vessel_name ?? "",
      product_family: item.product_family ?? "",
    }),
  );
  const line = lineFeature(`cargo-chain-${item.source ?? "cargo"}-${item.id}`, points, {
    geometry_source: "cargo_destination_buyer_graph",
    chain_kind: "cargo_destination_buyer_graph",
    vessel_name: item.vessel_name ?? "",
    product_family: item.product_family ?? "",
  });
  if (line) features.unshift(line);
  const focus = points[points.length - 1] ?? points[0];
  return {
    features: { type: "FeatureCollection", features },
    focus: focus ? { lat: focus.lat, lng: focus.lng } : null,
  };
}

function fmtPrice(value: unknown): string {
  const n = numberValue(value);
  if (n == null) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtCompact(value: unknown): string {
  const n = numberValue(value);
  if (n == null || n === 0) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function firstOwnershipName(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const first = value[0] as Record<string, unknown>;
  return textValue(first.parent_name) || textValue(first.owner_name);
}

function investorChainNodes(item: IntelInvestorPath): Record<string, unknown>[] {
  return Array.isArray(item.control_chain)
    ? item.control_chain.filter((node): node is Record<string, unknown> => !!node && typeof node === "object")
    : [];
}

function chainStepName(node: Record<string, unknown>): string {
  return textValue(node.short_label) || textValue(node.step).replaceAll("_", " ") || "chain step";
}

function routePointLabel(value?: string): string {
  const label = (value ?? "").trim();
  if (/^OSM way\s+\d+/i.test(label)) return "unnamed OSM terminal";
  if (/^Storage tank\s+\d+/i.test(label)) return "storage tank cluster";
  return label;
}

function decodedDestinationLabel(value: unknown): string {
  const decoded = recordValue(value);
  if (!decoded) return "";
  const port = textValue(decoded.port_name);
  const country = textValue(decoded.country_name) || textValue(decoded.country_code);
  if (port) return [port, country].filter(Boolean).join(", ");
  const unresolved = textValue(decoded.unresolved_destination);
  if (!unresolved) return "";
  const candidates = recordArray(decoded.candidates);
  const clue = candidates.length > 0 ? decodedDestinationLabel(candidates[candidates.length - 1]) : "";
  return clue ? `${unresolved} unresolved; clue ${clue}` : `${unresolved} unresolved`;
}

function partyName(parties: Record<string, unknown>[], role: string): string {
  const hit = parties.find((party) => textValue(party.role) === role);
  return textValue(hit?.name);
}

function cargoContactLabel(chain: Record<string, unknown>): string {
  const contactability = recordValue(chain.contactability);
  if (!contactability) return "";
  const score = numberValue(contactability.score);
  const label = textValue(contactability.best_label).replaceAll("_", " ");
  const direct = numberValue(contactability.direct_channels) ?? 0;
  if (direct > 0) return `contact ${score ?? direct}`;
  return label && score ? `${label} ${score}` : label;
}

function cargoBuyerMarketLabel(intel?: Record<string, unknown>): string {
  if (!intel) return "";
  const pressure = recordArray(intel.market_pressure);
  if (pressure.length === 0) return "";
  const top = pressure[0];
  const country = textValue(top.country_code);
  const product = textValue(top.product_code);
  const score = fmtScore(numberValue(top.buyer_pressure_score));
  return [country, product, score].filter(Boolean).join(" ");
}

function cargoBuyerCandidateLabel(intel?: Record<string, unknown>): string {
  if (!intel) return "";
  const assets = recordArray(intel.likely_assets);
  if (assets.length > 0) {
    return textValue(assets[0].asset_name) || textValue(assets[0].operator_name);
  }
  const importers = recordArray(intel.reported_importers);
  if (importers.length > 0) return textValue(importers[0].name);
  return "";
}

function cargoBuyerImporterLabel(intel?: Record<string, unknown>): string {
  if (!intel) return "";
  const importers = recordArray(intel.reported_importers);
  if (importers.length === 0) return "";
  const top = importers[0];
  const qty = fmtCompact(top.quantity);
  const unit = textValue(top.unit);
  return [textValue(top.name), qty && unit ? `${qty} ${unit}` : ""].filter(Boolean).join(" · ");
}

function cargoBuyerContactLabel(intel?: Record<string, unknown>): string {
  if (!intel) return "";
  const contactability = recordValue(intel.contactability);
  if (!contactability) return "";
  const direct = numberValue(contactability.direct_channels) ?? 0;
  const sourceLinks = numberValue(contactability.source_links) ?? 0;
  const score = numberValue(contactability.score);
  if (direct > 0) return `buyer contact ${fmtScore(score)} direct`;
  if (sourceLinks > 0) return `buyer profile ${fmtScore(score)} source`;
  return "";
}

function sourceRef(value?: Record<string, unknown>): string {
  if (!value) return "";
  const nested = recordArray(value.contacts).find((contact) => textValue(contact.source_ref) || textValue(contact.evidence));
  return textValue(value.source_ref) || textValue(value.evidence) || textValue(nested?.source_ref) || textValue(nested?.evidence);
}

function directContactLabel(value: Record<string, unknown>): string {
  const parts = [
    textValue(value.name),
    textValue(value.role).replaceAll("_", " "),
    textValue(value.email),
    textValue(value.phone),
    textValue(value.website),
    textValue(value.url),
  ].filter(Boolean);
  return parts.join(" · ");
}

function contactBundleDirectLabels(bundle: Record<string, unknown>): string[] {
  return recordArray(bundle.contacts).map(directContactLabel).filter(Boolean);
}

function ownershipRows(value: unknown, side: string): Record<string, unknown>[] {
  return recordArray(value).map((row) => ({ ...row, side }));
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function evidenceAssetName(opp: IntelOpportunity, role: "supplier_asset" | "buyer_asset"): string {
  const hit = opp.evidence?.find((item) => item.role === role);
  return typeof hit?.asset_name === "string" ? hit.asset_name : "";
}

function pressureText(opp: IntelOpportunity): string {
  const supplier = opp.market_pressure_summary?.supplier_availability_score;
  const buyer = opp.market_pressure_summary?.buyer_pressure_score;
  const parts: string[] = [];
  if (typeof supplier === "number") parts.push(`supplier ${fmtScore(supplier)}`);
  if (typeof buyer === "number") parts.push(`buyer ${fmtScore(buyer)}`);
  return parts.join(" / ");
}

function investorText(opp: IntelOpportunity): string {
  const investor = opp.market_pressure_summary?.investor_control as Record<string, unknown> | undefined;
  if (!investor) return "";
  if (investor.shared_investor_path) return "shared investor path";
  if (investor.supplier_exposure && investor.buyer_exposure) return "both sides exposed";
  if (investor.supplier_exposure) return "supplier exposed";
  if (investor.buyer_exposure) return "buyer exposed";
  return "";
}

function scoreRows(b: ScoreBreakdown | undefined): Array<[string, number | undefined]> {
  return [
    ["supplier", b?.supplier_reality],
    ["buyer", b?.buyer_reality],
    ["market", b?.market_pressure],
    ["route", b?.route_feasibility],
    ["investor", b?.investor_control],
  ];
}

function OpportunityCard({
  item,
  selected,
  onSelect,
}: {
  item: IntelOpportunity;
  selected: boolean;
  onSelect: (item: IntelOpportunity) => void;
}) {
  const supplierName = evidenceAssetName(item, "supplier_asset");
  const buyerName = evidenceAssetName(item, "buyer_asset");
  const investor = investorText(item);
  return (
    <button
      type="button"
      className={`opportunity-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(item)}
    >
      <div className="opportunity-card-top">
        <span className="badge partial compact">{item.evidence_grade ?? "inferred"}</span>
        <span className="opportunity-score">{fmtScore(item.score)}</span>
      </div>
      <strong className="opportunity-title">
        {item.commodity ?? "oil"} · {item.origin_country ?? "?"} - {item.destination_country ?? "?"}
      </strong>
      <span className="opportunity-route">
        {supplierName || "source asset"} {"->"} {buyerName || "destination asset"}
      </span>
      <div className="opportunity-score-grid">
        {scoreRows(item.score_breakdown).map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{fmtScore(value)}</strong>
          </span>
        ))}
      </div>
      <div className="opportunity-meta">
        {pressureText(item) && <span>{pressureText(item)}</span>}
        {investor && <span>{investor}</span>}
        {item.generated_at && <span>{shortDate(item.generated_at)}</span>}
      </div>
    </button>
  );
}

function CargoRow({
  item,
  selected,
  onSelect,
}: {
  item: IntelCargoMovement;
  selected: boolean;
  onSelect: (item: IntelCargoMovement) => void;
}) {
  const qty = item.quantity?.best ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}` : "";
  const chain = item.commercial_chain ?? {};
  const parties = recordArray(chain.parties);
  const steps = recordArray(chain.chain_steps);
  const previous = recordArray(chain.previous_owner_candidates);
  const registryChecks = recordArray(chain.registry_checks);
  const parent = partyName(parties, "parent_or_group");
  const owner = item.owner_name || partyName(parties, "registered_owner");
  const operator = item.operator_name || partyName(parties, "operator_manager");
  const shipper = partyName(parties, "shipper");
  const consignee = partyName(parties, "consignee");
  const contact = cargoContactLabel(chain);
  const ownershipTier = textValue(chain.ownership_confidence_tier);
  const buyerIntel = recordValue(chain.destination_buyer_intel);
  const buyerMarket = cargoBuyerMarketLabel(buyerIntel);
  const buyerCandidate = cargoBuyerCandidateLabel(buyerIntel);
  const buyerImporter = cargoBuyerImporterLabel(buyerIntel);
  const buyerContact = cargoBuyerContactLabel(buyerIntel);
  const generalContact = buyerContact && contact.startsWith("source link only") ? "" : contact;
  const routeSource = (item.route_hint?.source ?? textValue(recordValue(chain.route)?.source)).replaceAll("_", " ");
  const routeConfidence = item.route_hint?.confidence_score ?? numberValue(recordValue(chain.route)?.confidence_score);
  const latestDestination = item.route_hint?.latest_destination ?? textValue(recordValue(chain.route)?.latest_destination);
  const decodedDestination = item.route_hint?.decoded_destination ?? recordValue(recordValue(chain.route)?.decoded_destination);
  const decodedDestinationText = decodedDestinationLabel(decodedDestination);
  const latestDestinationText = decodedDestinationText || latestDestination;
  const loadLabel = routePointLabel(item.load?.port || item.load?.country);
  const rawDischarge = item.discharge?.port || item.discharge?.country;
  const dischargeLabel = decodedDestinationText && latestDestination && rawDischarge === latestDestination
    ? decodedDestinationText
    : routePointLabel(rawDischarge);
  const route = [
    loadLabel,
    dischargeLabel,
  ].filter(Boolean).join(" -> ");
  return (
    <button
      type="button"
      className={`opportunity-row cargo-intel-row ${selected ? "selected" : ""}`}
      onClick={() => onSelect(item)}
    >
      <Ship size={14} />
      <div>
        <div className="opportunity-card-top">
          <span className="badge partial compact">{item.evidence_label ?? "estimated"}</span>
        </div>
        <strong>{item.vessel_name || item.imo || item.mmsi || "vessel"}</strong>
        <span>
          {[item.product_family, qty, route].filter(Boolean).join(" · ")}
        </span>
        <div className="opportunity-meta cargo-meta">
          {owner && <span>owner {owner}</span>}
          {parent && <span>group {parent}</span>}
          {operator && operator !== owner && <span>manager {operator}</span>}
          {shipper && <span>shipper {shipper}</span>}
          {consignee && <span>buyer {consignee}</span>}
          {routeSource && <span>route {routeSource}{routeConfidence ? ` ${Math.round(routeConfidence)}` : ""}</span>}
          {latestDestinationText && (!route || routeSource === "ais destination") && <span>dest {latestDestinationText}</span>}
          {buyerMarket && <span>buyer market {buyerMarket}</span>}
          {buyerCandidate && <span>buyer candidate {buyerCandidate}</span>}
          {buyerImporter && <span>reported importer {buyerImporter}</span>}
          {buyerContact && <span>{buyerContact}</span>}
          {generalContact && <span>{generalContact}</span>}
          {ownershipTier && <span>owner {ownershipTier}</span>}
          {registryChecks.length > 0 && <span>{registryChecks.length} registry checks</span>}
        </div>
        {previous.length > 0 && (
          <span className="cargo-warning">
            previous clue: {[textValue(previous[0].disponent), textValue(previous[0].vessel_name)].filter(Boolean).join(" / ")}
          </span>
        )}
        {steps.length > 0 && (
          <div className="opportunity-chain-steps cargo-chain-steps">
            {steps.slice(0, 6).map((step, idx) => (
              <span key={`${item.id}-cargo-step-${idx}`}>
                <b>{chainStepName(step)}</b>
                <em>{["load", "discharge", "ais_destination"].includes(textValue(step.step)) ? routePointLabel(textValue(step.label)) : textValue(step.label)}</em>
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function STSRow({ item }: { item: IntelSTSPrediction }) {
  const payload = item.payload ?? {};
  const a = String(payload.vessel_a_name ?? payload.vessel_a ?? "");
  const b = String(payload.vessel_b_name ?? payload.vessel_b ?? "");
  const product = String(payload.product_hint ?? "");
  const stsKind = textValue(payload.sts_kind) || textValue(payload.event_status) || "predicted";
  return (
    <div className="opportunity-row">
      <Waves size={14} />
      <div>
        <div className="opportunity-card-top">
          <span className="badge partial compact">predicted</span>
          <small>{stsKind.replaceAll("_", " ")}</small>
        </div>
        <strong>{[a, b].filter(Boolean).join(" / ") || "predicted STS pair"}</strong>
        <span>
          {[product, item.horizon_hours ? `${item.horizon_hours}h horizon` : "", `${fmtScore(item.confidence_score)} confidence`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

function GapStateList({ title, items }: { title?: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="opportunity-inspector-section">
      {title && <strong>{title}</strong>}
      <div className="opportunity-contact-list">
        {items.map((item) => (
          <span key={item}>
            <em>{item}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function brokerAlphaGaps(params: {
  opportunities: IntelOpportunity[];
  cargo: IntelCargoMovement[];
  sts: IntelSTSPrediction[];
  importers: IntelImporter[];
  investorPaths: IntelInvestorPath[];
  selectedCargo: IntelCargoMovement | null;
  margin: IntelArbitrage | null;
}): string[] {
  const gaps: string[] = [];
  if (params.opportunities.length === 0 && params.cargo.length === 0) {
    gaps.push("counterparty intent pending");
  }
  const hasRouteStress = params.opportunities.some(
    (item) => numberValue(item.score_breakdown?.route_feasibility) != null,
  );
  if (!hasRouteStress) gaps.push("route stress pending");
  if (params.cargo.length === 0) gaps.push("open tonnage pending");
  const hasFeedstock = params.cargo.some((item) => textValue(item.product_family));
  if (!hasFeedstock) gaps.push("feedstock fit pending");
  gaps.push("tank stress pending");
  if (params.opportunities.length === 0) gaps.push("repeat lane pending");
  const cargoContacts = recordArray(params.selectedCargo?.commercial_chain?.contacts);
  const hasOutreach = cargoContacts.length > 0
    || params.investorPaths.some((item) => textValue(item.investor?.name));
  if (!hasOutreach) gaps.push("outreach pack pending");
  if (!params.margin) gaps.push("landed margin pending");
  return gaps;
}

function ImporterRow({ item }: { item: IntelImporter }) {
  const quantity =
    typeof item.quantity?.value === "number"
      ? `${Math.round(item.quantity.value).toLocaleString()} ${item.quantity.unit ?? "kbbl"}`
      : "";
  const ports = item.port_count ? `${item.port_count} ports` : "";
  return (
    <div className="opportunity-row">
      <Building2 size={14} />
      <div>
        <div className="opportunity-card-top">
          <span className="badge partial compact">reported</span>
        </div>
        <strong>{item.name || "reported importer"}</strong>
        <span>
          {[
            item.product_code,
            item.origin_country?.country_code ? `from ${item.origin_country.country_code}` : "",
            quantity,
            ports,
            item.latest_month ? shortDate(item.latest_month) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}

function InspectorMetric({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function ChainStepList({ steps }: { steps: Record<string, unknown>[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="opportunity-inspector-section">
      <strong>Commercial chain steps</strong>
      <div className="opportunity-inspector-steps">
        {steps.slice(0, 10).map((step, idx) => (
          <span key={`${textValue(step.step) || "step"}-${idx}`}>
            <b>{chainStepName(step)}</b>
            <em>{textValue(step.label) || textValue(step.asset) || textValue(step.role)}</em>
            {textValue(step.evidence_label) && <small>{textValue(step.evidence_label)}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

function ContactBundleList({ bundles }: { bundles: Record<string, unknown>[] }) {
  if (bundles.length === 0) return null;
  return (
    <div className="opportunity-inspector-section">
      <strong>Contacts and source refs</strong>
      <div className="opportunity-contact-list">
        {bundles.slice(0, 6).map((bundle, idx) => {
          const direct = contactBundleDirectLabels(bundle);
          const ref = sourceRef(bundle);
          return (
            <span key={`${textValue(bundle.role) || "contact"}-${idx}`}>
              <b>{textValue(bundle.name) || textValue(bundle.asset_name) || "source-backed party"}</b>
              <em>{[textValue(bundle.role).replaceAll("_", " "), textValue(bundle.tier), textValue(bundle.country_code)].filter(Boolean).join(" · ")}</em>
              {direct.length > 0 ? (
                <small>{direct.slice(0, 2).join(" · ")}</small>
              ) : ref ? (
                <small>{ref}</small>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function OwnershipList({ rows }: { rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="opportunity-inspector-section">
      <strong>Ownership and control</strong>
      <div className="opportunity-contact-list">
        {rows.slice(0, 6).map((row, idx) => (
          <span key={`${textValue(row.side)}-${idx}`}>
            <b>{textValue(row.parent_name) || textValue(row.owner_name) || textValue(row.operator_name) || "reported owner"}</b>
            <em>
              {[
                textValue(row.side),
                textValue(row.owner_name) && textValue(row.parent_name) ? `owner ${textValue(row.owner_name)}` : "",
                numberValue(row.share_pct) != null ? `${fmtScore(numberValue(row.share_pct))}%` : "",
              ].filter(Boolean).join(" · ")}
            </em>
            {textValue(row.evidence_label) && <small>{textValue(row.evidence_label)}</small>}
          </span>
        ))}
      </div>
    </div>
  );
}

function InvestorChainInspector({ item }: { item: IntelInvestorPath }) {
  const chain = investorChainNodes(item);
  const ownership = [
    ...ownershipRows(item.supplier?.gem_ownership, "supplier"),
    ...ownershipRows(item.buyer?.gem_ownership, "buyer"),
  ];
  const investor = item.investor?.name || "reported investor";
  const exposureTypes = item.investor?.exposure_types?.join(", ");
  const price = fmtPrice(item.price_context?.price);
  const benchmark = textValue(item.price_context?.benchmark_key) || textValue(item.price_context?.benchmark);
  return (
    <div className="opportunity-chain-inspector">
      <div className="opportunity-inspector-head">
        <span className="badge partial compact">{item.evidence_label ?? "inferred"}</span>
        <strong>{investor}</strong>
      </div>
      {item.commercial_thesis && <p>{item.commercial_thesis}</p>}
      <div className="opportunity-inspector-grid">
        <InspectorMetric label="score" value={fmtScore(item.score)} />
        <InspectorMetric label="role" value={item.investor?.exposure_role?.replaceAll("_", " ")} />
        <InspectorMetric label="exposure" value={exposureTypes} />
        <InspectorMetric label="market stress" value={`supplier ${fmtScore(numberValue(item.market?.supplier_availability_score))} / buyer ${fmtScore(numberValue(item.market?.buyer_pressure_score))}`} />
        <InspectorMetric label="benchmark context" value={price ? `${benchmark} USD ${price}` : benchmark} />
      </div>
      <ChainStepList steps={chain} />
      <OwnershipList rows={ownership} />
      {item.limitations && item.limitations.length > 0 && (
        <div className="opportunity-inspector-section">
          <strong>Limitations</strong>
          <small>{item.limitations.slice(0, 3).join(" ")}</small>
        </div>
      )}
    </div>
  );
}

function CargoChainInspector({ item }: { item: IntelCargoMovement }) {
  const chain = item.commercial_chain ?? {};
  const ownerIntel = recordValue(chain.ownership_intel);
  const buyerIntel = recordValue(chain.destination_buyer_intel);
  const steps = recordArray(chain.chain_steps);
  const contacts = recordArray(chain.contacts);
  const buyerContacts = recordArray(buyerIntel?.contacts);
  const assets = recordArray(buyerIntel?.likely_assets);
  const importers = recordArray(buyerIntel?.reported_importers);
  const market = recordArray(buyerIntel?.market_pressure);
  const registryChecks = recordArray(chain.registry_checks);
  const previous = recordArray(chain.previous_owner_candidates);
  const pivots = recordArray(ownerIntel?.search_pivots).length > 0
    ? recordArray(ownerIntel?.search_pivots)
    : (Array.isArray(ownerIntel?.search_pivots) ? (ownerIntel?.search_pivots as string[]).map((label) => ({ label })) : []);
  const qty = item.quantity?.best ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}` : "";
  const buyerScore = cargoBuyerMarketLabel(buyerIntel);
  const ownershipSummary = textValue(ownerIntel?.summary);
  return (
    <div className="opportunity-chain-inspector">
      <div className="opportunity-inspector-head">
        <span className="badge partial compact">{item.evidence_label ?? "estimated"}</span>
        <strong>{item.vessel_name || item.imo || item.mmsi || "cargo movement"}</strong>
      </div>
      <div className="opportunity-inspector-grid">
        <InspectorMetric label="product" value={item.product_family} />
        <InspectorMetric label="quantity" value={qty} />
        <InspectorMetric label="owner tier" value={textValue(ownerIntel?.tier) || textValue(chain.ownership_confidence_tier)} />
        <InspectorMetric label="buyer market" value={buyerScore} />
        <InspectorMetric label="buyer profile" value={cargoBuyerContactLabel(buyerIntel)} />
      </div>
      {ownershipSummary && <p>{ownershipSummary}</p>}
      <ChainStepList steps={steps} />
      {(contacts.length > 0 || buyerContacts.length > 0) && (
        <ContactBundleList bundles={[...contacts, ...buyerContacts]} />
      )}
      {assets.length > 0 && (
        <div className="opportunity-inspector-section">
          <strong>Likely buyer assets</strong>
          <div className="opportunity-contact-list">
            {assets.slice(0, 4).map((asset, idx) => (
              <span key={`${textValue(asset.asset_id) || "asset"}-${idx}`}>
                <b>{textValue(asset.asset_name) || textValue(asset.operator_name)}</b>
                <em>{[textValue(asset.asset_type).replaceAll("_", " "), textValue(asset.country_name), `confidence ${fmtScore(numberValue(asset.confidence_score))}`].filter(Boolean).join(" · ")}</em>
                {textValue(asset.operator_name) && <small>operator {textValue(asset.operator_name)}</small>}
              </span>
            ))}
          </div>
        </div>
      )}
      {(importers.length > 0 || market.length > 0) && (
        <div className="opportunity-inspector-section">
          <strong>Buyer pressure and demand</strong>
          <div className="opportunity-contact-list">
            {market.slice(0, 3).map((row, idx) => (
              <span key={`market-${idx}`}>
                <b>{[textValue(row.country_code), textValue(row.product_code)].filter(Boolean).join(" ")}</b>
                <em>buyer pressure {fmtScore(numberValue(row.buyer_pressure_score))}</em>
                {textValue(row.month) && <small>{shortDate(textValue(row.month))}</small>}
              </span>
            ))}
            {importers.slice(0, 3).map((row, idx) => (
              <span key={`importer-${idx}`}>
                <b>{textValue(row.name) || "reported importer"}</b>
                <em>{[fmtCompact(row.quantity), textValue(row.unit)].filter(Boolean).join(" ")}</em>
                {textValue(row.source_ref) && <small>{textValue(row.source_ref)}</small>}
              </span>
            ))}
          </div>
        </div>
      )}
      {(previous.length > 0 || registryChecks.length > 0 || pivots.length > 0) && (
        <div className="opportunity-inspector-section">
          <strong>Ownership history checks</strong>
          <div className="opportunity-contact-list">
            {previous.slice(0, 3).map((row, idx) => (
              <span key={`previous-${idx}`}>
                <b>{textValue(row.disponent) || textValue(row.owner_name) || "previous owner clue"}</b>
                <em>{[textValue(row.vessel_name), textValue(row.source)].filter(Boolean).join(" · ")}</em>
              </span>
            ))}
            {registryChecks.slice(0, 4).map((row, idx) => (
              <span key={`registry-${idx}`}>
                <b>{textValue(row.name)}</b>
                <em>{textValue(row.status).replaceAll("_", " ")}</em>
                <small>{textValue(row.query) || textValue(row.purpose)}</small>
              </span>
            ))}
            {pivots.slice(0, 3).map((row, idx) => (
              <span key={`pivot-${idx}`}>
                <b>search pivot</b>
                <em>{textValue(row.label)}</em>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectedChainInspector({
  investorPath,
  cargo,
}: {
  investorPath?: IntelInvestorPath | null;
  cargo?: IntelCargoMovement | null;
}) {
  if (cargo) return <CargoChainInspector item={cargo} />;
  if (investorPath) return <InvestorChainInspector item={investorPath} />;
  return null;
}

function InvestorPathRow({
  item,
  selected,
  onSelect,
}: {
  item: IntelInvestorPath;
  selected: boolean;
  onSelect: (item: IntelInvestorPath) => void;
}) {
  const supplier = textValue(item.supplier?.asset_name) || textValue(item.supplier?.operator_name) || "supplier side";
  const buyer = textValue(item.buyer?.asset_name) || textValue(item.buyer?.operator_name) || "buyer side";
  const supplierControl =
    firstOwnershipName(item.supplier?.gem_ownership) || textValue(item.supplier?.operator_name) || "supplier control";
  const buyerControl =
    firstOwnershipName(item.buyer?.gem_ownership) || textValue(item.buyer?.operator_name) || "buyer control";
  const investor = item.investor?.name || "reported investor";
  const role = (item.investor?.exposure_role ?? "portfolio_context").replaceAll("_", " ");
  const exposure = fmtCompact(item.investor?.exposure_value);
  const unit = item.investor?.exposure_unit ?? "";
  const buyerPressure = fmtScore(numberValue(item.market?.buyer_pressure_score));
  const supplierPressure = fmtScore(numberValue(item.market?.supplier_availability_score));
  const benchmark = textValue(item.price_context?.benchmark_key) || textValue(item.price_context?.benchmark);
  const price = fmtPrice(item.price_context?.price);
  const currency = textValue(item.price_context?.currency) || "USD";
  const chain = investorChainNodes(item);
  return (
    <button
      type="button"
      className={`opportunity-chain-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(item)}
    >
      <div className="opportunity-chain-head">
        <span className="badge partial compact">{item.evidence_label ?? "inferred"}</span>
        <strong>{fmtScore(item.score)}</strong>
      </div>
      <strong className="opportunity-title">{investor}</strong>
      <span className="opportunity-route">
        {item.commodity ?? "oil/gas"} · {item.origin_country ?? "?"} {"->"} {item.destination_country ?? "?"}
      </span>
      <p>{item.commercial_thesis}</p>
      <div className="opportunity-chain-path">
        <span>{investor}</span>
        <span>{supplierControl}</span>
        <span>{supplier}</span>
        <span>{buyerControl}</span>
        <span>{buyer}</span>
        {benchmark && <span>{benchmark}</span>}
      </div>
      <div className="opportunity-meta">
        <span>{role}</span>
        {exposure && <span>{exposure} {unit}</span>}
        <span>supplier {supplierPressure} / buyer {buyerPressure}</span>
        {price && <span>{currency} {price}</span>}
      </div>
      {chain.length > 0 && (
        <div className="opportunity-chain-steps">
          {chain.slice(0, 6).map((step, idx) => (
            <span key={`${item.id}-${idx}`}>
              <b>{chainStepName(step)}</b>
              <em>{textValue(step.label) || textValue(step.asset)}</em>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function PriceContextPanel({ item }: { item: IntelOpportunity | null }) {
  const ctx = item?.price_context;
  if (!ctx || Object.keys(ctx).length === 0) {
    return (
      <div className="opportunity-price-context">
        <div>
          <CircleDollarSign size={14} />
          <strong>Benchmark context · indicative only</strong>
        </div>
        <span>Pink Sheet adapter pending</span>
      </div>
    );
  }
  const benchmark = textValue(ctx.benchmark_key) || textValue(ctx.benchmark);
  const price = fmtPrice(ctx.price);
  const unit = textValue(ctx.unit);
  const currency = textValue(ctx.currency) || "USD";
  const observedAt = shortDate(textValue(ctx.observed_at));
  const context = textValue(ctx.context);
  return (
    <div className="opportunity-price-context">
      <div>
        <CircleDollarSign size={14} />
        <strong>Benchmark context · indicative only</strong>
      </div>
      <span>
        {[benchmark, price ? `${currency} ${price}${unit}` : "", observedAt].filter(Boolean).join(" · ")}
      </span>
      {context && <small>{context}</small>}
      <small>Scenario context only — not a buy, sell, or price forecast.</small>
    </div>
  );
}

function MarginPanel({ value }: { value: IntelArbitrage | null }) {
  if (!value) {
    return (
      <div className="opportunity-margin-empty">
        <CircleDollarSign size={15} />
        <span>landed margin pending</span>
      </div>
    );
  }
  const benchmark = value.benchmarks?.[0];
  const price = fmtPrice(benchmark?.price);
  const unit = textValue(benchmark?.unit);
  const currency = textValue(benchmark?.currency) || "USD";
  const benchmarkName = textValue(benchmark?.benchmark);
  return (
    <div className="opportunity-margin">
      <div className="opportunity-margin-head">
        <CircleDollarSign size={15} />
        <strong>Scenario margin · indicative only</strong>
      </div>
      <span>
        {[value.commodity, [value.origin, value.destination].filter(Boolean).join(" -> ")].filter(Boolean).join(" · ")}
        {price ? ` · ${benchmarkName ? `${benchmarkName} ` : ""}${currency} ${price}${unit}` : ""}
      </span>
      <small>Freight curve, quality adjustment, and landed margin bands may still be pending.</small>
    </div>
  );
}

export default function OpportunityOriginatorPanel({
  onChainFocus,
  onClearChainFocus,
}: OpportunityOriginatorPanelProps) {
  const [tab, setTab] = useState("lanes");
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<IntelOpportunity[]>([]);
  const [cargo, setCargo] = useState<IntelCargoMovement[]>([]);
  const [importers, setImporters] = useState<IntelImporter[]>([]);
  const [investorPaths, setInvestorPaths] = useState<IntelInvestorPath[]>([]);
  const [sts, setSts] = useState<IntelSTSPrediction[]>([]);
  const [selected, setSelected] = useState<IntelOpportunity | null>(null);
  const [selectedInvestorPathId, setSelectedInvestorPathId] = useState<string | null>(null);
  const [selectedCargoId, setSelectedCargoId] = useState<string | null>(null);
  const [margin, setMargin] = useState<IntelArbitrage | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchIntelOpportunities({ limit: 30 }).then(setOpportunities),
      fetchIntelCargoMovements({ limit: 10 }).then(setCargo),
      fetchIntelImporters({ limit: 10 }).then(setImporters),
      fetchIntelInvestorPaths({ limit: 12 }).then(setInvestorPaths),
      fetchIntelSTSPredictions(10).then(setSts),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelected((prev) => prev ?? opportunities[0] ?? null);
  }, [opportunities]);

  const stats = useMemo(() => {
    const mapped = opportunities.filter((o) =>
      o.evidence?.some((e) => e.mapped_geometry === true),
    ).length;
    return { mapped };
  }, [opportunities]);
  const selectedInvestorPath = useMemo(
    () => investorPaths.find((item) => item.id === selectedInvestorPathId) ?? null,
    [investorPaths, selectedInvestorPathId],
  );
  const selectedCargo = useMemo(
    () => cargo.find((item) => `${item.source ?? "cargo"}-${item.id}` === selectedCargoId) ?? null,
    [cargo, selectedCargoId],
  );
  const alphaGaps = useMemo(
    () => brokerAlphaGaps({
      opportunities,
      cargo,
      sts,
      importers,
      investorPaths,
      selectedCargo,
      margin,
    }),
    [opportunities, cargo, sts, importers, investorPaths, selectedCargo, margin],
  );

  const compareMargin = async (item: IntelOpportunity | null) => {
    if (!item) return;
    setMarginLoading(true);
    try {
      setMargin(
        await fetchIntelArbitrage({
          origin: item.origin_country,
          destination: item.destination_country,
          commodity: item.commodity,
        }),
      );
    } finally {
      setMarginLoading(false);
    }
  };

  const publishPayload = (payload: ChainMapPayload) => {
    if (payload.features.features.length === 0) {
      onClearChainFocus?.();
      return;
    }
    onChainFocus?.(payload.features, payload.focus ?? null);
  };

  const selectOpportunity = (next: IntelOpportunity) => {
    setSelected(next);
    setSelectedCargoId(null);
    setMargin(null);
    const path = investorPaths.find((item) => item.id === next.id || item.id.startsWith(`${next.id}:`));
    if (path) {
      setSelectedInvestorPathId(path.id);
      publishPayload(investorPathMapPayload(path));
    } else {
      setSelectedInvestorPathId(null);
      onClearChainFocus?.();
    }
  };

  const selectInvestorPath = (next: IntelInvestorPath) => {
    setSelectedInvestorPathId(next.id);
    setSelectedCargoId(null);
    const lane = opportunities.find((item) => next.id === item.id || next.id.startsWith(`${item.id}:`));
    if (lane) setSelected(lane);
    publishPayload(investorPathMapPayload(next));
  };

  const selectCargo = (next: IntelCargoMovement) => {
    setSelectedCargoId(`${next.source ?? "cargo"}-${next.id}`);
    setSelectedInvestorPathId(null);
    publishPayload(cargoMapPayload(next));
  };

  return (
    <div className="opportunity-panel">
      <div className="opportunity-kpis">
        <div>
          <Route size={15} />
          <strong>{opportunities.length}</strong>
          <span>chains</span>
        </div>
        <div>
          <Gauge size={15} />
          <strong>{stats.mapped}</strong>
          <span>mapped</span>
        </div>
        <div>
          <BarChart3 size={15} />
          <strong>{investorPaths.length}</strong>
          <span>ownership</span>
        </div>
        <div>
          <Building2 size={15} />
          <strong>{importers.length}</strong>
          <span>buyers</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lanes">Chain</TabsTrigger>
          <TabsTrigger value="investors">Ownership</TabsTrigger>
          <TabsTrigger value="buyers">Buyers</TabsTrigger>
          <TabsTrigger value="cargo">Cargo</TabsTrigger>
          <TabsTrigger value="sts">STS</TabsTrigger>
        </TabsList>

        <TabsContent value="lanes">
          {loading && <p className="opportunity-muted">Loading commercial chains...</p>}
          {!loading && opportunities.length === 0 && (
            <GapStateList
              title="Commercial chain"
              items={["repeat lane pending", "counterparty intent pending"]}
            />
          )}
          <div className="opportunity-card-stack">
            {opportunities.map((item) => (
              <OpportunityCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                onSelect={selectOpportunity}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="investors">
          {!loading && investorPaths.length === 0 && (
            <GapStateList
              title="Ownership and control"
              items={["previous ownership check pending", "ownership path pending"]}
            />
          )}
          <div className="opportunity-card-stack">
            {investorPaths.map((item) => (
              <InvestorPathRow
                key={item.id}
                item={item}
                selected={selectedInvestorPathId === item.id}
                onSelect={selectInvestorPath}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="buyers">
          {!loading && importers.length === 0 && (
            <GapStateList
              title="Buyers"
              items={["buyer pressure pending", "reported importer pending"]}
            />
          )}
          <div className="opportunity-list">
            {importers.map((item) => (
              <ImporterRow
                key={`${item.company_id || item.name}-${item.product_code}-${item.origin_country?.country_code}`}
                item={item}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="cargo">
          {!loading && cargo.length === 0 && (
            <GapStateList
              title="Cargo and voyages"
              items={["open tonnage pending", "cargo movement pending"]}
            />
          )}
          <div className="opportunity-list">
            {cargo.map((item) => (
              <CargoRow
                key={`${item.source}-${item.id}`}
                item={item}
                selected={selectedCargoId === `${item.source ?? "cargo"}-${item.id}`}
                onSelect={selectCargo}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="sts">
          {!loading && sts.length === 0 && (
            <GapStateList
              title="STS coverage"
              items={[
                "open tonnage pending — no open-vessel STS lead yet",
                "no predicted STS pair yet",
                "no active or completed STS event yet",
              ]}
            />
          )}
          <div className="opportunity-list">
            {sts.map((item) => (
              <STSRow key={item.id} item={item} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <SelectedChainInspector investorPath={selectedInvestorPath} cargo={selectedCargo} />

      <div className="opportunity-actions">
        <button
          type="button"
          className="panel-btn"
          disabled={!selected || marginLoading}
          onClick={() => compareMargin(selected)}
        >
          {marginLoading ? "Comparing..." : "Compare scenario margin"}
        </button>
        {selected?.lane_id && <span>{selected.lane_id}</span>}
      </div>

      <PriceContextPanel item={selected} />
      <MarginPanel value={margin} />
      {!loading && alphaGaps.length > 0 && (
        <GapStateList title="Broker alpha gaps" items={alphaGaps} />
      )}
      <p className="disclaimer">
        Evidence labels separate observed, reported, source-backed, inferred, estimated, and predicted intelligence.
        Market and margin panels are indicative scenario context only — not buy, sell, or forecast signals.
      </p>
    </div>
  );
}
