"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, CircleDollarSign, Gauge, Route, Ship, Waves } from "lucide-react";
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

function CargoRow({ item }: { item: IntelCargoMovement }) {
  const qty = item.quantity?.best ? `${Math.round(item.quantity.best).toLocaleString()} ${item.quantity.unit ?? "t"}` : "";
  return (
    <div className="opportunity-row">
      <Ship size={14} />
      <div>
        <strong>{item.vessel_name || item.imo || item.mmsi || "vessel"}</strong>
        <span>
          {[item.product_family, qty, item.load?.country, item.discharge?.country].filter(Boolean).join(" · ")}
        </span>
      </div>
    </div>
  );
}

function STSRow({ item }: { item: IntelSTSPrediction }) {
  const payload = item.payload ?? {};
  const a = String(payload.vessel_a_name ?? payload.vessel_a ?? "");
  const b = String(payload.vessel_b_name ?? payload.vessel_b ?? "");
  const product = String(payload.product_hint ?? "");
  return (
    <div className="opportunity-row">
      <Waves size={14} />
      <div>
        <strong>{[a, b].filter(Boolean).join(" / ") || "commercial STS pair"}</strong>
        <span>
          {[product, item.horizon_hours ? `${item.horizon_hours}h` : "", `${fmtScore(item.confidence_score)} confidence`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
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

function InvestorPathRow({ item }: { item: IntelInvestorPath }) {
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
  const chain = item.control_chain ?? [];
  return (
    <div className="opportunity-chain-card">
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
            <span key={`${item.id}-${idx}`}>{textValue(step.step).replaceAll("_", " ")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceContextPanel({ item }: { item: IntelOpportunity | null }) {
  const ctx = item?.price_context;
  if (!ctx || Object.keys(ctx).length === 0) return null;
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
        <strong>Price context</strong>
      </div>
      <span>
        {[benchmark, price ? `${currency} ${price}${unit}` : "", observedAt].filter(Boolean).join(" · ")}
      </span>
      {context && <small>{context}</small>}
    </div>
  );
}

function MarginPanel({ value }: { value: IntelArbitrage | null }) {
  if (!value) {
    return (
      <div className="opportunity-margin-empty">
        <CircleDollarSign size={15} />
        <span>No margin context selected</span>
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
        <strong>{value.commodity || "commodity"} margin context</strong>
      </div>
      <span>
        {[value.origin, value.destination].filter(Boolean).join(" -> ")}
        {price ? ` · ${benchmarkName ? `${benchmarkName} ` : ""}${currency} ${price}${unit}` : ""}
      </span>
    </div>
  );
}

export default function OpportunityOriginatorPanel() {
  const [tab, setTab] = useState("lanes");
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<IntelOpportunity[]>([]);
  const [cargo, setCargo] = useState<IntelCargoMovement[]>([]);
  const [importers, setImporters] = useState<IntelImporter[]>([]);
  const [investorPaths, setInvestorPaths] = useState<IntelInvestorPath[]>([]);
  const [sts, setSts] = useState<IntelSTSPrediction[]>([]);
  const [selected, setSelected] = useState<IntelOpportunity | null>(null);
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

  return (
    <div className="opportunity-panel">
      <div className="opportunity-kpis">
        <div>
          <Route size={15} />
          <strong>{opportunities.length}</strong>
          <span>lanes</span>
        </div>
        <div>
          <Gauge size={15} />
          <strong>{stats.mapped}</strong>
          <span>mapped</span>
        </div>
        <div>
          <BarChart3 size={15} />
          <strong>{investorPaths.length}</strong>
          <span>paths</span>
        </div>
        <div>
          <Building2 size={15} />
          <strong>{importers.length}</strong>
          <span>buyers</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="lanes">Lanes</TabsTrigger>
          <TabsTrigger value="investors">Investors</TabsTrigger>
          <TabsTrigger value="buyers">Buyers</TabsTrigger>
          <TabsTrigger value="cargo">Cargo</TabsTrigger>
          <TabsTrigger value="sts">STS</TabsTrigger>
        </TabsList>

        <TabsContent value="lanes">
          {loading && <p className="opportunity-muted">Loading opportunities...</p>}
          {!loading && opportunities.length === 0 && (
            <p className="opportunity-muted">No active opportunity candidates.</p>
          )}
          <div className="opportunity-card-stack">
            {opportunities.map((item) => (
              <OpportunityCard
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                onSelect={(next) => {
                  setSelected(next);
                  setMargin(null);
                }}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="investors">
          {!loading && investorPaths.length === 0 && (
            <p className="opportunity-muted">No named investor control paths yet.</p>
          )}
          <div className="opportunity-card-stack">
            {investorPaths.map((item) => (
              <InvestorPathRow key={item.id} item={item} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="buyers">
          {!loading && importers.length === 0 && <p className="opportunity-muted">No reported importers yet.</p>}
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
          {!loading && cargo.length === 0 && <p className="opportunity-muted">No cargo movement clues yet.</p>}
          <div className="opportunity-list">
            {cargo.map((item) => (
              <CargoRow key={`${item.source}-${item.id}`} item={item} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="sts">
          {!loading && sts.length === 0 && <p className="opportunity-muted">No active commercial STS predictions.</p>}
          <div className="opportunity-list">
            {sts.map((item) => (
              <STSRow key={item.id} item={item} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <div className="opportunity-actions">
        <button
          type="button"
          className="panel-btn"
          disabled={!selected || marginLoading}
          onClick={() => compareMargin(selected)}
        >
          {marginLoading ? "Comparing..." : "Compare landed margin"}
        </button>
        {selected?.lane_id && <span>{selected.lane_id}</span>}
      </div>

      <PriceContextPanel item={selected} />
      <MarginPanel value={margin} />
      <p className="disclaimer">
        Evidence labels separate reported assets, estimated pressure, inferred lanes, and predicted STS.
      </p>
    </div>
  );
}
