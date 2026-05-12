import { MarketTickerRow } from '../types';
import { normalizeCommodityLabel } from './commodities';

const TROY_OUNCES_PER_KILOGRAM = 32.1507465686;
const POUNDS_PER_KILOGRAM = 2.2046226218;

type CommoditySupportLevel = 'roi_supported' | 'benchmark_only' | 'unsupported';

export interface CommodityMarketSnapshot {
  requestedLabel: string;
  displayLabel: string;
  benchmarkLabel: string;
  benchmarkDisplayPrice: string;
  benchmarkUnit: string | null;
  benchmarkSymbol?: string;
  priceOk: boolean;
  supportLevel: CommoditySupportLevel;
  supportLabel: string;
  supportDetail: string;
  discountPct?: number;
  logisticsCost?: number;
  logisticsUnit?: string;
  netbackPerUnit?: number;
  netbackUnit?: string;
}

function parseTickerNumber(price?: string): number {
  if (!price) return Number.NaN;
  const cleaned = price.replace(/[^0-9.+-]+/g, '');
  return cleaned ? Number.parseFloat(cleaned) : Number.NaN;
}

function findTickerRow(rows: MarketTickerRow[], symbol: string): MarketTickerRow | undefined {
  return rows.find((row) => row.symbol === symbol);
}

function buildUnsupportedSnapshot(displayLabel: string, detail: string): CommodityMarketSnapshot {
  return {
    requestedLabel: displayLabel,
    displayLabel,
    benchmarkLabel: `${displayLabel} benchmark`,
    benchmarkDisplayPrice: '—',
    benchmarkUnit: null,
    priceOk: false,
    supportLevel: 'unsupported',
    supportLabel: 'UNSUPPORTED',
    supportDetail: detail,
  };
}

function buildBenchmarkOnlySnapshot(args: {
  displayLabel: string;
  benchmarkLabel: string;
  benchmarkDisplayPrice: string;
  benchmarkUnit: string;
  benchmarkSymbol: string;
  priceOk: boolean;
  supportDetail: string;
}): CommodityMarketSnapshot {
  return {
    requestedLabel: args.displayLabel,
    displayLabel: args.displayLabel,
    benchmarkLabel: args.benchmarkLabel,
    benchmarkDisplayPrice: args.priceOk ? args.benchmarkDisplayPrice : '—',
    benchmarkUnit: args.benchmarkUnit,
    benchmarkSymbol: args.benchmarkSymbol,
    priceOk: args.priceOk,
    supportLevel: 'benchmark_only',
    supportLabel: args.priceOk ? 'BENCHMARK ONLY' : 'NO FEED',
    supportDetail: args.supportDetail,
  };
}

function goldSnapshot(displayLabel: string, rows: MarketTickerRow[]): CommodityMarketSnapshot {
  const row = findTickerRow(rows, 'GOLD/oz');
  const pricePerOz = parseTickerNumber(row?.price);
  const priceOk = Number.isFinite(pricePerOz) && pricePerOz > 100;
  const benchmarkPerKg = priceOk ? pricePerOz * TROY_OUNCES_PER_KILOGRAM : Number.NaN;
  const discountPct = 12;
  const logisticsCost = 2400;
  const netbackPerUnit = priceOk ? benchmarkPerKg * (1 - discountPct / 100) - logisticsCost : Number.NaN;

  return {
    requestedLabel: displayLabel,
    displayLabel,
    benchmarkLabel: `${displayLabel} Market (LIVE)`,
    benchmarkDisplayPrice: priceOk
      ? `$${benchmarkPerKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} / KG`
      : '—',
    benchmarkUnit: 'KG',
    benchmarkSymbol: 'GOLD/oz',
    priceOk,
    supportLevel: 'roi_supported',
    supportLabel: priceOk ? 'DEMO NETBACK' : 'NO FEED',
    supportDetail:
      'Live gold benchmark is mapped. The dossier netback still uses the existing demo discount and logistics assumptions.',
    discountPct,
    logisticsCost,
    logisticsUnit: 'KG',
    netbackPerUnit: Number.isFinite(netbackPerUnit) ? netbackPerUnit : undefined,
    netbackUnit: 'KG',
  };
}

function silverSnapshot(displayLabel: string, rows: MarketTickerRow[]): CommodityMarketSnapshot {
  const row = findTickerRow(rows, 'SILVER/oz');
  const pricePerOz = parseTickerNumber(row?.price);
  const priceOk = Number.isFinite(pricePerOz) && pricePerOz > 1;
  const benchmarkPerKg = priceOk ? pricePerOz * TROY_OUNCES_PER_KILOGRAM : Number.NaN;

  return buildBenchmarkOnlySnapshot({
    displayLabel,
    benchmarkLabel: `${displayLabel} Market (LIVE)`,
    benchmarkDisplayPrice: `$${benchmarkPerKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} / KG`,
    benchmarkUnit: 'KG',
    benchmarkSymbol: 'SILVER/oz',
    priceOk,
    supportDetail:
      'Live silver pricing is available, but the dossier netback model is not calibrated for silver yet.',
  });
}

function copperSnapshot(displayLabel: string, rows: MarketTickerRow[]): CommodityMarketSnapshot {
  const row = findTickerRow(rows, 'COPPER');
  const pricePerLb = parseTickerNumber(row?.price);
  const priceOk = Number.isFinite(pricePerLb) && pricePerLb > 0;
  const benchmarkPerKg = priceOk ? pricePerLb * POUNDS_PER_KILOGRAM : Number.NaN;

  return buildBenchmarkOnlySnapshot({
    displayLabel,
    benchmarkLabel: `${displayLabel} Market (LIVE)`,
    benchmarkDisplayPrice: `$${benchmarkPerKg.toLocaleString(undefined, { maximumFractionDigits: 2 })} / KG`,
    benchmarkUnit: 'KG',
    benchmarkSymbol: 'COPPER',
    priceOk,
    supportDetail:
      'Copper is mapped to the live COMEX benchmark, but the dossier netback model is not calibrated for base metals yet.',
  });
}

function brentSnapshot(displayLabel: string, rows: MarketTickerRow[]): CommodityMarketSnapshot {
  const row = findTickerRow(rows, 'BRENT');
  const pricePerBbl = parseTickerNumber(row?.price);
  const priceOk = Number.isFinite(pricePerBbl) && pricePerBbl > 0;

  return buildBenchmarkOnlySnapshot({
    displayLabel,
    benchmarkLabel: 'Brent Benchmark (LIVE)',
    benchmarkDisplayPrice: priceOk
      ? `$${pricePerBbl.toLocaleString(undefined, { maximumFractionDigits: 2 })} / BBL`
      : '—',
    benchmarkUnit: 'BBL',
    benchmarkSymbol: 'BRENT',
    priceOk,
    supportDetail:
      'Crude and petroleum licenses now map to Brent for market context. The dossier ROI math is not calibrated for barrel-based economics yet.',
  });
}

function heatingOilSnapshot(displayLabel: string, rows: MarketTickerRow[]): CommodityMarketSnapshot {
  const row = findTickerRow(rows, 'HEATING OIL');
  const pricePerGal = parseTickerNumber(row?.price);
  const priceOk = Number.isFinite(pricePerGal) && pricePerGal > 0;

  return buildBenchmarkOnlySnapshot({
    displayLabel,
    benchmarkLabel: 'Refined Products Benchmark (LIVE)',
    benchmarkDisplayPrice: priceOk
      ? `$${pricePerGal.toLocaleString(undefined, { maximumFractionDigits: 3 })} / GAL`
      : '—',
    benchmarkUnit: 'GAL',
    benchmarkSymbol: 'HEATING OIL',
    priceOk,
    supportDetail:
      'Refined fuels map to the live heating-oil benchmark for directional context. The dossier ROI math is not calibrated for refined products yet.',
  });
}

function classifyCommodity(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes('gold')) return 'gold';
  if (normalized.includes('silver')) return 'silver';
  if (normalized.includes('copper')) return 'copper';
  if (
    normalized.includes('diesel') ||
    normalized.includes('petrol') ||
    normalized.includes('gasoline') ||
    normalized.includes('jet fuel') ||
    normalized.includes('kerosene') ||
    normalized.includes('fuel oil') ||
    normalized.includes('refin')
  ) {
    return 'refined_oil';
  }
  if (
    normalized.includes('lng') ||
    normalized.includes('lpg') ||
    normalized.includes('natural gas') ||
    normalized === 'gas'
  ) {
    return 'gas';
  }
  if (
    normalized.includes('crude') ||
    normalized.includes('petroleum') ||
    normalized.includes('hydrocarbon') ||
    normalized.includes('oil')
  ) {
    return 'crude_oil';
  }
  return 'unsupported';
}

export function getCommodityMarketSnapshot(
  requestedLabel: string | undefined,
  rows: MarketTickerRow[]
): CommodityMarketSnapshot {
  const displayLabel = normalizeCommodityLabel(requestedLabel || '') || 'Unknown';

  switch (classifyCommodity(displayLabel)) {
    case 'gold':
      return goldSnapshot(displayLabel, rows);
    case 'silver':
      return silverSnapshot(displayLabel, rows);
    case 'copper':
      return copperSnapshot(displayLabel, rows);
    case 'refined_oil':
      return heatingOilSnapshot(displayLabel, rows);
    case 'crude_oil':
      return brentSnapshot(displayLabel, rows);
    case 'gas':
      return buildUnsupportedSnapshot(
        displayLabel,
        'Gas-linked licenses are shown explicitly, but the current ticker does not provide a live LNG/LPG benchmark yet.'
      );
    default:
      return buildUnsupportedSnapshot(
        displayLabel,
        'This commodity is on the record, but the current market ticker does not have a mapped live benchmark for it yet.'
      );
  }
}
