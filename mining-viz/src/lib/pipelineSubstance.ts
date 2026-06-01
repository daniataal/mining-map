import type { PetroleumLayerId } from './petroleumLayers';

export type PipelineSubstance = 'oil' | 'gas' | 'water' | 'other' | 'unknown';

const SUBSTANCE_TAG_MAP: Record<string, PipelineSubstance> = {
  oil: 'oil',
  crude: 'oil',
  crude_oil: 'oil',
  petroleum: 'oil',
  gas: 'gas',
  natural_gas: 'gas',
  lng: 'gas',
  lpg: 'gas',
  methane: 'gas',
  water: 'water',
  drinking_water: 'water',
  wastewater: 'water',
  sewage: 'water',
};

const TYPE_TAG_MAP: Record<string, PipelineSubstance> = {
  oil: 'oil',
  gas: 'gas',
  water: 'water',
};

const OIL_KEYWORDS =
  /\b(oil|crude|petroleum|pipeline\s+oil|نفط|נפט)\b/i;
const GAS_KEYWORDS =
  /\b(natural\s+gas|lng|lpg|methane|gas\s+pipeline|גז)\b/i;
const WATER_KEYWORDS =
  /(مياه|מים|water|wasser|eau|aqueduct|irrigation|sewer|sewage|wastewater|drinking\s+water|water\s+main|watermain|water\s+supply|water\s+project)/i;

const NAME_KEYS = ['name', 'name:en', 'name:ar', 'name:he', 'description', 'ref'] as const;

function normTag(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
}

function firstString(props: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const raw = props[key];
    if (raw == null) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return null;
}

function nameHaystack(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of NAME_KEYS) {
    const raw = props[key];
    if (raw != null && String(raw).trim()) parts.push(String(raw));
  }
  return parts.join(' ');
}

/** Infer oil | gas | water | other | unknown from OSM tags and names. */
export function classifyPipelineSubstance(props: Record<string, unknown>): PipelineSubstance {
  const preclassified = firstString(props, ['pipeline_substance', 'pipelineSubstance']);
  if (preclassified) {
    const norm = normTag(preclassified);
    if (
      norm === 'oil' ||
      norm === 'gas' ||
      norm === 'water' ||
      norm === 'other' ||
      norm === 'unknown'
    ) {
      return norm;
    }
  }

  const substanceRaw = normTag(firstString(props, ['substance', 'Substance']));
  if (substanceRaw) {
    const mapped = SUBSTANCE_TAG_MAP[substanceRaw];
    if (mapped) return mapped;
  }

  const typeRaw = normTag(firstString(props, ['type', 'Type']));
  if (typeRaw) {
    const mapped = TYPE_TAG_MAP[typeRaw];
    if (mapped) return mapped;
  }

  const usage = normTag(firstString(props, ['usage', 'Usage']));
  if (usage === 'water' || usage === 'drinking_water' || usage === 'irrigation') return 'water';
  if (usage === 'oil') return 'oil';
  if (usage === 'gas') return 'gas';

  const haystack = nameHaystack(props);
  if (haystack) {
    const waterHit = WATER_KEYWORDS.test(haystack);
    const oilHit = OIL_KEYWORDS.test(haystack);
    const gasHit = GAS_KEYWORDS.test(haystack);
    if (waterHit && !oilHit && !gasHit) return 'water';
    if (gasHit && !waterHit && !oilHit) return 'gas';
    if (oilHit && !waterHit && !gasHit) return 'oil';
    if (waterHit) return 'water';
  }

  if (props.man_made === 'pipeline' || props.man_made === 'Pipeline') {
    return 'unknown';
  }
  return 'unknown';
}

export function pipelineSubstanceDisplayLabel(substance: PipelineSubstance): string {
  switch (substance) {
    case 'oil':
      return 'Oil pipeline';
    case 'gas':
      return 'Gas pipeline';
    case 'water':
      return 'Water pipeline';
    case 'other':
      return 'Pipeline';
    case 'unknown':
      return 'Pipeline (substance not tagged)';
  }
}

/** Layer id used for popup accent when substance is known; unknown uses oil styling. */
export function pipelineSubstancePopupLayerId(substance: PipelineSubstance): PetroleumLayerId {
  if (substance === 'gas') return 'gas_pipelines';
  return 'oil_pipelines';
}

export function isWaterPipeline(props: Record<string, unknown>): boolean {
  return classifyPipelineSubstance(props) === 'water';
}

export function shouldIncludeInOilGasPipelineLayer(
  props: Record<string, unknown>,
  layerId: 'oil_pipelines' | 'gas_pipelines'
): boolean {
  const substance = classifyPipelineSubstance(props);
  if (substance === 'water') return false;
  if (layerId === 'oil_pipelines' && substance === 'gas') return false;
  if (layerId === 'gas_pipelines' && substance === 'oil') return false;
  return true;
}

export function splitOsmPipelineFeatures(
  features: GeoJSON.Feature[]
): { oilGas: GeoJSON.Feature[]; water: GeoJSON.Feature[] } {
  const oilGas: GeoJSON.Feature[] = [];
  const water: GeoJSON.Feature[] = [];
  for (const feature of features) {
    const props = (feature.properties || {}) as Record<string, unknown>;
    if (isWaterPipeline(props)) {
      water.push(feature);
    } else {
      oilGas.push(feature);
    }
  }
  return { oilGas, water };
}
