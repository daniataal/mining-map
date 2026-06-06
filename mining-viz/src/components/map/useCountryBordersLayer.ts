import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import type { MiningLicense } from '../../types';
import { getCountryBorders } from '../../lib/api';
import {
  countryLicenseCountsForBorders,
  countriesForMapBorders,
} from '../../lib/countriesWithVisibleLicenses';
import { LICENSE_MAP_BORDER_COUNTRY_CAP } from '../../lib/licenseCountrySummary';

type UseCountryBordersLayerArgs = {
  displayData: MiningLicense[];
  /** When country-focused, use this wider dataset so neighbor outlines stay clickable. */
  borderSourceData?: MiningLicense[];
  countryFocusCountry?: string | null;
  isRoutePlannerView: boolean;
  isDark: boolean;
};

export function useCountryBordersLayer({
  displayData,
  borderSourceData,
  countryFocusCountry,
  isRoutePlannerView,
  isDark,
}: UseCountryBordersLayerArgs) {
  const { borderCountries, borderCountriesCapped } = useMemo(() => {
    if (isRoutePlannerView) {
      return { borderCountries: [] as string[], borderCountriesCapped: false };
    }
    const focus = countryFocusCountry?.trim();
    const source = borderSourceData ?? displayData;
    if (focus) {
      const regional = countriesForMapBorders(source, LICENSE_MAP_BORDER_COUNTRY_CAP).filter(
        (c) => c !== focus,
      );
      const borderList = [focus, ...regional].slice(0, LICENSE_MAP_BORDER_COUNTRY_CAP);
      return { borderCountries: borderList, borderCountriesCapped: false };
    }
    const borderList = countriesForMapBorders(displayData, LICENSE_MAP_BORDER_COUNTRY_CAP);
    const ranked = countryLicenseCountsForBorders(displayData);
    const capped = ranked.length > LICENSE_MAP_BORDER_COUNTRY_CAP;
    return {
      borderCountries: borderList,
      borderCountriesCapped: capped,
    };
  }, [countryFocusCountry, displayData, borderSourceData, isRoutePlannerView]);

  const borderCountriesKey = useMemo(
    () => borderCountries.slice().sort((a, b) => a.localeCompare(b)).join('|'),
    [borderCountries],
  );

  const { data: filteredGeoJson, isPlaceholderData: borderGeoJsonPlaceholder } = useQuery({
    queryKey: ['country-borders', borderCountriesKey],
    queryFn: () => getCountryBorders(borderCountries),
    enabled: borderCountries.length > 0,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchOnWindowFocus: false,
  });
  const borderGeoJsonMatchesMarkers = Boolean(filteredGeoJson) && !borderGeoJsonPlaceholder;
  const countryBorderRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  const countryBorderPathStyle = useMemo(
    () =>
      isDark
        ? {
            className: 'map-country-border map-country-border--dark',
            fillColor: '#06b6d4',
            color: '#06b6d4',
            weight: 1.5,
            opacity: 0.4,
            fillOpacity: 0.05,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          }
        : {
            className: 'map-country-border map-country-border--light',
            fillColor: '#0284c7',
            color: '#0369a1',
            weight: 2,
            opacity: 0.85,
            fillOpacity: 0.04,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          },
    [isDark],
  );

  const countryBorderLayerStyle = useMemo(() => {
    if (countryFocusCountry?.trim()) {
      return isDark
        ? {
            className: 'map-country-border map-country-border--focus map-country-border--dark',
            fillColor: '#f59e0b',
            color: '#fbbf24',
            weight: 3,
            opacity: 0.95,
            fillOpacity: 0.08,
            renderer: countryBorderRenderer,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          }
        : {
            className: 'map-country-border map-country-border--focus map-country-border--light',
            fillColor: '#f59e0b',
            color: '#d97706',
            weight: 2.5,
            opacity: 0.9,
            fillOpacity: 0.06,
            renderer: countryBorderRenderer,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          };
    }
    return {
      ...countryBorderPathStyle,
      renderer: countryBorderRenderer,
    };
  }, [countryFocusCountry, isDark, countryBorderPathStyle, countryBorderRenderer]);

  const countryBorderNeighborStyle = useMemo(
    () =>
      isDark
        ? {
            className: 'map-country-border map-country-border--neighbor map-country-border--dark',
            fillColor: '#06b6d4',
            color: '#64748b',
            weight: 1.25,
            opacity: 0.45,
            fillOpacity: 0.02,
            renderer: countryBorderRenderer,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          }
        : {
            className: 'map-country-border map-country-border--neighbor map-country-border--light',
            fillColor: '#0284c7',
            color: '#64748b',
            weight: 1.25,
            opacity: 0.55,
            fillOpacity: 0.02,
            renderer: countryBorderRenderer,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          },
    [isDark, countryBorderRenderer],
  );

  return {
    borderCountries,
    borderCountriesCapped,
    borderGeoJsonMatchesMarkers,
    filteredGeoJson,
    countryBorderLayerStyle,
    countryBorderNeighborStyle,
  };
}
