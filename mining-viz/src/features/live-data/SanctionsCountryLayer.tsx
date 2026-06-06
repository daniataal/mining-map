import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GeoJSON, LayerGroup } from 'react-leaflet';
import type L from 'leaflet';
import { getCountryBorders, type CountryBordersGeoJson } from '../../lib/api';
import { getSanctionsCountrySummary } from '../../api/oilLiveApi';
import {
  buildSanctionsLookup,
  normalizeSanctionsCountryKey,
  sanctionsChoroplethStyle,
  sanctionsFlagLevelForCountry,
} from '../../lib/sanctionsCountryLayer';

type Props = {
  enabled: boolean;
  isDark: boolean;
  /** Countries already rendered by the main border layer (skip duplicate fetch). */
  existingBorderCountries?: string[];
  onCountrySelect?: (country: string) => void;
};

function featureCountryName(feature: GeoJSON.Feature | undefined): string | undefined {
  const props = feature?.properties as Record<string, unknown> | undefined;
  return (
    (props?.name as string | undefined) ??
    (props?.ADMIN as string | undefined) ??
    (props?.country as string | undefined)
  );
}

/** Extra choropleth borders for screened countries not in the license viewport set. */
export function SanctionsCountryLayer({
  enabled,
  isDark,
  existingBorderCountries = [],
  onCountrySelect,
}: Props) {
  const { data: summary } = useQuery({
    queryKey: ['oil-live-sanctions-country-summary'] as const,
    queryFn: () => getSanctionsCountrySummary(),
    enabled,
    staleTime: 120_000,
    refetchInterval: enabled ? 300_000 : false,
  });

  const lookup = useMemo(() => buildSanctionsLookup(summary?.countries), [summary?.countries]);

  const extraCountries = useMemo(() => {
    if (!enabled || !summary?.countries?.length) return [] as string[];
    const existing = new Set(existingBorderCountries.map(normalizeSanctionsCountryKey));
    const names: string[] = [];
    for (const row of summary.countries) {
      if (row.coverage !== 'screened') continue;
      const key = normalizeSanctionsCountryKey(row.country_name);
      if (!existing.has(key)) {
        names.push(row.country_name);
      }
    }
    return names;
  }, [enabled, summary?.countries, existingBorderCountries]);

  const countriesKey = useMemo(
    () => extraCountries.slice().sort((a, b) => a.localeCompare(b)).join('|'),
    [extraCountries],
  );

  const { data: extraGeoJson } = useQuery({
    queryKey: ['country-borders', 'sanctions-extra', countriesKey] as const,
    queryFn: () => getCountryBorders(extraCountries),
    enabled: enabled && extraCountries.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchOnWindowFocus: false,
  });

  if (!enabled || !summary) return null;

  const styleForFeature = (feature?: GeoJSON.Feature): L.PathOptions => {
    const name = featureCountryName(feature);
    const row = sanctionsFlagLevelForCountry(lookup, name);
    const choropleth = sanctionsChoroplethStyle(row, isDark);
    if (!choropleth) {
      return { opacity: 0, fillOpacity: 0, weight: 0 };
    }
    return {
      className: 'map-sanctions-choropleth',
      ...choropleth,
      lineCap: 'round',
      lineJoin: 'round',
    };
  };

  const bindCountry = (feature: GeoJSON.Feature, layer: L.Layer) => {
    const name = featureCountryName(feature);
    if (!name) return;
    const row = sanctionsFlagLevelForCountry(lookup, name);
    layer.on({
      click: (e) => {
        e.originalEvent?.stopPropagation();
        onCountrySelect?.(name);
      },
    });
    if (row?.coverage === 'screened' && layer.bindPopup) {
      layer.bindPopup(
        `<div class="oil-live-popup-body">
          <strong>${name}</strong>
          <p>${row.flag_level ?? 'clear'} · ${row.match_count} match(es) · ${row.screened_entity_count} screened</p>
          <p class="oil-live-popup-muted">${summary.disclaimer}</p>
        </div>`,
      );
    }
  };

  return (
    <LayerGroup>
      {extraGeoJson && (
        <GeoJSON
          key={`sanctions-extra:${isDark ? 'd' : 'l'}:${countriesKey}`}
          data={extraGeoJson as CountryBordersGeoJson}
          style={(feature) => styleForFeature(feature as GeoJSON.Feature)}
          onEachFeature={(feature, layer) => bindCountry(feature as GeoJSON.Feature, layer)}
        />
      )}
      {!extraGeoJson && summary.countries.length === 0 && null}
    </LayerGroup>
  );
}

export default SanctionsCountryLayer;
