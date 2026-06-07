import {
  Anchor,
  Database,
  Droplets,
  Factory,
  Map as MapIcon,
  Pickaxe,
  Route,
  Shield,
  Ship,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  INTELLIGENCE_MODES,
  intelligenceModeLabel,
  sublayerLabel,
  SUBLAYERS_FOR_MODE,
  type IntelligenceMode,
  type IntelligenceSublayer,
} from '../lib/intelligenceModes';
import { globalMapLens, globalMapLensHelperCopy } from '../lib/globalMapLens';
import { assetsMapLens, assetsMapLensHelperCopy } from '../lib/assetsMapLens';
import {
  ASSET_LAYER_PRESETS,
  CORE_ASSET_LAYER_IDS,
  OPTIONAL_ASSET_LAYER_IDS,
  activeAssetLayerCount,
  type AssetLayerId,
  type AssetLayerPresetId,
  type AssetLayerVisibility,
} from '../lib/assetLayerCockpit';

type Props = {
  mode: IntelligenceMode;
  sublayer: IntelligenceSublayer;
  onModeChange: (mode: IntelligenceMode) => void;
  onSublayerChange: (sublayer: IntelligenceSublayer) => void;
  investigationsBadge?: number;
  assetLayerVisibility?: AssetLayerVisibility;
  assetLayerCounts?: Partial<Record<AssetLayerId, number | null | undefined>>;
  onAssetLayerToggle?: (layerId: AssetLayerId) => void;
  onAssetPreset?: (presetId: AssetLayerPresetId) => void;
};

const ASSET_LAYER_LABELS: Record<AssetLayerId, string> = {
  mines: 'Mines',
  oil_fields: 'Oil Fields',
  refineries: 'Refineries',
  tank_farms: 'Tank Farms',
  ports: 'Ports',
  pipelines: 'Pipelines',
  lng: 'LNG',
  ais_vessels: 'AIS',
  country_borders: 'Borders',
  esg_zones: 'ESG',
};

const ASSET_PRESET_LABELS: Record<AssetLayerPresetId, string> = {
  overview: 'Overview',
  mining: 'Mining',
  oil_logistics: 'Oil Logistics',
  port_export: 'Port Export',
  clean: 'Clean Map',
};

const ASSET_LAYER_ICONS: Record<AssetLayerId, typeof Pickaxe> = {
  mines: Pickaxe,
  oil_fields: Droplets,
  refineries: Factory,
  tank_farms: Database,
  ports: Anchor,
  pipelines: Route,
  lng: Droplets,
  ais_vessels: Ship,
  country_borders: MapIcon,
  esg_zones: Shield,
};

const ALL_ASSET_LAYER_IDS: readonly AssetLayerId[] = [
  ...CORE_ASSET_LAYER_IDS,
  ...OPTIONAL_ASSET_LAYER_IDS,
];

export function IntelligenceModeNav({
  mode,
  sublayer,
  onModeChange,
  onSublayerChange,
  investigationsBadge = 0,
  assetLayerVisibility,
  assetLayerCounts,
  onAssetLayerToggle,
  onAssetPreset,
}: Props) {
  const { t } = useI18n();
  const sublayers = SUBLAYERS_FOR_MODE[mode];
  const activeGlobalLens = globalMapLens(mode, sublayer);
  const activeAssetsLens = assetsMapLens(mode, sublayer);
  const activeAssetPreset = assetLayerVisibility
    ? (Object.keys(ASSET_LAYER_PRESETS) as AssetLayerPresetId[]).find((preset) =>
        ALL_ASSET_LAYER_IDS.every(
          (layerId) => assetLayerVisibility[layerId] === ASSET_LAYER_PRESETS[preset][layerId],
        ),
      )
    : null;
  const baseLensHelper = activeGlobalLens
    ? globalMapLensHelperCopy(activeGlobalLens)
    : activeAssetsLens
      ? assetsMapLensHelperCopy(activeAssetsLens)
      : null;
  const assetCoreLayerCount = assetLayerVisibility ? activeAssetLayerCount(assetLayerVisibility) : 0;
  const lensHelper =
    mode === 'assets' && assetLayerVisibility
      ? assetCoreLayerCount > 1
        ? {
            he: 'Asset overview: mines, upstream, refineries, storage, ports and infrastructure.',
            en: 'Asset overview: mines, upstream, refineries, storage, ports and infrastructure.',
          }
        : assetCoreLayerCount === 0
          ? {
              he: 'Clean map: workspace pins and selected overlays only.',
              en: 'Clean map: workspace pins and selected overlays only.',
            }
          : baseLensHelper
      : baseLensHelper;

  return (
    <div className="flex flex-col gap-2 items-end">
      <div className="flex gap-0.5 sm:gap-1.5 bg-stone-100/90 sm:bg-stone-100/80 dark:bg-slate-950/60 dark:sm:bg-slate-950/40 backdrop-blur-2xl p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border border-stone-200/90 sm:border-stone-200/70 dark:border-white/10 dark:sm:border-white/5 shadow-2xl">
        {INTELLIGENCE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`px-3 sm:px-4 py-2 sm:py-1.5 rounded-lg sm:rounded-xl text-[10px] font-black uppercase tracking-widest transition-all min-h-[44px] sm:min-h-0 flex items-center gap-1.5 ${
              mode === m
                ? 'bg-amber-500 text-slate-950 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
            }`}
          >
            {t(intelligenceModeLabel(m), intelligenceModeLabel(m))}
            {m === 'investigations' && investigationsBadge > 0 && (
              <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-slate-950/20 dark:bg-white/20 text-[9px] font-black px-1">
                {investigationsBadge}
              </span>
            )}
          </button>
        ))}
      </div>
      {mode === 'assets' && assetLayerVisibility && onAssetLayerToggle ? (
        <div className="flex max-w-[min(100vw-1.5rem,44rem)] flex-col items-end gap-1.5 rounded-2xl border border-white/10 bg-slate-950/55 p-2 shadow-2xl backdrop-blur-2xl">
          <div className="flex w-full flex-wrap justify-end gap-1">
            {(Object.keys(ASSET_LAYER_PRESETS) as AssetLayerPresetId[]).map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={activeAssetPreset === preset}
                onClick={() => onAssetPreset?.(preset)}
                className={`rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-widest transition ${
                  activeAssetPreset === preset
                    ? 'border-amber-300 bg-amber-400 text-slate-950 shadow-[0_0_16px_rgba(245,158,11,0.22)]'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                }`}
              >
                {t(ASSET_PRESET_LABELS[preset], ASSET_PRESET_LABELS[preset])}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-wrap justify-end gap-1">
            {CORE_ASSET_LAYER_IDS.map((id) => {
              const Icon = ASSET_LAYER_ICONS[id];
              const active = assetLayerVisibility[id];
              const count = assetLayerCounts?.[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onAssetLayerToggle(id)}
                  className={`flex min-h-[34px] items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                    active
                      ? 'border-amber-400/60 bg-amber-400/20 text-amber-100 shadow-[0_0_16px_rgba(245,158,11,0.18)]'
                      : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  }`}
                  title={ASSET_LAYER_LABELS[id]}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{t(ASSET_LAYER_LABELS[id], ASSET_LAYER_LABELS[id])}</span>
                  {typeof count === 'number' && (
                    <span className="rounded-full bg-slate-950/45 px-1.5 py-0.5 text-[8px] text-slate-200">
                      {count.toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex w-full flex-wrap justify-end gap-1">
            {OPTIONAL_ASSET_LAYER_IDS.map((id) => {
              const Icon = ASSET_LAYER_ICONS[id];
              const active = assetLayerVisibility[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onAssetLayerToggle(id)}
                  className={`flex min-h-[28px] items-center gap-1 rounded-lg border px-2 py-1 text-[8px] font-black uppercase tracking-widest transition-all ${
                    active
                      ? 'border-cyan-400/45 bg-cyan-400/12 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                  }`}
                  title={ASSET_LAYER_LABELS[id]}
                >
                  <Icon className="h-3 w-3 shrink-0" aria-hidden />
                  <span>{t(ASSET_LAYER_LABELS[id], ASSET_LAYER_LABELS[id])}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : sublayers.length > 1 && (
        <div className="flex flex-wrap gap-1 justify-end max-w-[min(100%,28rem)]">
          {sublayers.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSublayerChange(s)}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                sublayer === s
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  : 'border-stone-200/80 dark:border-white/10 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(sublayerLabel(s), sublayerLabel(s))}
            </button>
          ))}
        </div>
      )}
      {lensHelper && (
        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 text-right max-w-[min(100%,28rem)]">
          {t(lensHelper.he, lensHelper.en)}
        </p>
      )}
    </div>
  );
}
