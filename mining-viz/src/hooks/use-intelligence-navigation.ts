import { useCallback, useMemo, useState, startTransition } from 'react';
import { INTELLIGENCE_COCKPIT_ENABLED } from '../lib/intelligenceCockpitFlag';
import {
  DEFAULT_SUBLAYER,
  legacyToIntelligence,
  resolveLicenseSector,
  resolveMapViewKey,
  suppliersPipelineActive,
  type IntelligenceMode,
  type IntelligenceSublayer,
  type LegacyViewMode,
} from '../lib/intelligenceModes';

export function useIntelligenceNavigation() {
  const [legacyViewMode, setLegacyViewMode] = useState<LegacyViewMode>('global');
  const [intelligenceMode, setIntelligenceMode] = useState<IntelligenceMode>('global_view');
  const [intelligenceSublayer, setIntelligenceSublayer] =
    useState<IntelligenceSublayer>('countries');
  const [overlayMode, setOverlayMode] = useState<'admin' | null>(null);

  const viewMode: LegacyViewMode = useMemo(() => {
    if (!INTELLIGENCE_COCKPIT_ENABLED) return legacyViewMode;
    if (overlayMode === 'admin') return 'admin';
    return resolveMapViewKey(intelligenceMode, intelligenceSublayer);
  }, [legacyViewMode, intelligenceMode, intelligenceSublayer, overlayMode]);

  const licenseSector = useMemo(() => {
    if (INTELLIGENCE_COCKPIT_ENABLED) {
      return resolveLicenseSector(intelligenceMode, intelligenceSublayer);
    }
    if (viewMode === 'mining') return 'mining' as const;
    if (viewMode === 'oil_and_gas') return 'oil_and_gas' as const;
    return undefined;
  }, [intelligenceMode, intelligenceSublayer, viewMode]);

  const suppliersPipelineMode = useMemo(
    () =>
      INTELLIGENCE_COCKPIT_ENABLED
        ? suppliersPipelineActive(intelligenceMode, intelligenceSublayer)
        : false,
    [intelligenceMode, intelligenceSublayer],
  );

  const setViewMode = useCallback((mode: LegacyViewMode) => {
    if (mode === 'admin') {
      setOverlayMode('admin');
      return;
    }
    setOverlayMode(null);
    if (INTELLIGENCE_COCKPIT_ENABLED) {
      const mapped = legacyToIntelligence(mode);
      startTransition(() => {
        setIntelligenceMode(mapped.mode);
        setIntelligenceSublayer(mapped.sublayer);
      });
      return;
    }
    setLegacyViewMode(mode);
  }, []);

  const switchIntelligenceMode = useCallback((mode: IntelligenceMode) => {
    setOverlayMode(null);
    startTransition(() => {
      setIntelligenceMode(mode);
      setIntelligenceSublayer(DEFAULT_SUBLAYER[mode]);
    });
  }, []);

  const switchIntelligenceSublayer = useCallback((sublayer: IntelligenceSublayer) => {
    startTransition(() => {
      setIntelligenceSublayer(sublayer);
    });
  }, []);

  const switchSectorView = useCallback((mode: 'global' | 'mining' | 'oil_and_gas') => {
    if (INTELLIGENCE_COCKPIT_ENABLED) {
      if (mode === 'global') switchIntelligenceMode('global_view');
      else if (mode === 'mining') {
        switchIntelligenceMode('assets');
        switchIntelligenceSublayer('mines');
      } else {
        switchIntelligenceMode('assets');
        switchIntelligenceSublayer('oil_fields');
      }
      return;
    }
    setLegacyViewMode(mode);
  }, [switchIntelligenceMode, switchIntelligenceSublayer]);

  return {
    viewMode,
    setViewMode,
    licenseSector,
    suppliersPipelineMode,
    intelligenceMode,
    intelligenceSublayer,
    switchIntelligenceMode,
    switchIntelligenceSublayer,
    switchSectorView,
    cockpitEnabled: INTELLIGENCE_COCKPIT_ENABLED,
    closeAdmin: () => setOverlayMode(null),
  };
}
