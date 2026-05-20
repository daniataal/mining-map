import { useMemo, useState, useRef, useEffect, useCallback, startTransition } from 'react';
import {
  getLicenseCommodityLabels,
  licenseMatchesSelectedCommodities,
} from '../lib/commodities';
import { FilterResultCache } from '../lib/filterResultCache';
import { buildLicenseSearchIndex, licenseHaystackMatches } from '../lib/licenseSearchIndex';
import { matchesSuppliersPipeline } from '../lib/suppliersPipeline';
import { MiningLicense, UserAnnotation } from '../types';

function normalizeSubtypeLabel(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return '';
  return raw
    .replaceAll('_', ' ')
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function sourceLabelsForItem(item: MiningLicense): string[] {
  const labels = new Set<string>();
  for (const label of item.sourceLabels || []) {
    const clean = label.trim();
    if (clean) labels.add(clean);
  }
  if (item.sourceName?.trim()) labels.add(item.sourceName.trim());
  if (labels.size === 0 && item.recordOrigin?.trim()) labels.add(item.recordOrigin.trim());
  return Array.from(labels);
}

function confidenceBucketFromScore(score?: number | null): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return '';
  if (score >= 0.8) return 'High confidence';
  if (score >= 0.65) return 'Medium confidence';
  return 'Needs review';
}

function buildProcessedDataCacheKey(
  rawDataLength: number,
  appliedFilter: string,
  sortBy: string,
  selectedCountry: string[],
  selectedCommodity: string[],
  selectedLicenseType: string[],
  userStatusFilter: string[],
  selectedEntitySubtype: string[],
  selectedSourceLabel: string[],
  selectedConfidenceBucket: string[],
  selectedSector: string | null,
  portLinkedOnly: boolean,
  suppliersPipelineMode: boolean,
  suppliersShowAll: boolean,
  annotationRevision: number,
): string {
  return [
    rawDataLength,
    appliedFilter,
    sortBy,
    selectedCountry.join('\u0001'),
    selectedCommodity.join('\u0001'),
    selectedLicenseType.join('\u0001'),
    userStatusFilter.join('\u0001'),
    selectedEntitySubtype.join('\u0001'),
    selectedSourceLabel.join('\u0001'),
    selectedConfidenceBucket.join('\u0001'),
    selectedSector ?? '',
    portLinkedOnly ? '1' : '0',
    suppliersPipelineMode ? '1' : '0',
    suppliersShowAll ? '1' : '0',
    String(annotationRevision),
  ].join('|');
}

export const useMiningData = (
  rawData: MiningLicense[],
  userAnnotations: Record<string, UserAnnotation>,
  options?: { suppliersPipelineMode?: boolean },
) => {
  const suppliersPipelineMode = Boolean(options?.suppliersPipelineMode);
  const [filter, setFilter] = useState('');
  /** Drives license list + map; updated on Enter / clear, not on every keystroke. */
  const [appliedFilter, setAppliedFilter] = useState('');
  const setFilterDeferred = useCallback((value: string) => {
    startTransition(() => {
      setFilter(value);
      if (!value.trim()) setAppliedFilter('');
    });
  }, []);
  const commitSearchFilter = useCallback((value?: string) => {
    const raw = value ?? filter;
    const next = raw.trim();
    startTransition(() => {
      setFilter(raw);
      setAppliedFilter(next);
    });
  }, [filter]);
  const [sortBy, setSortBy] = useState<keyof MiningLicense>('company');
  const [selectedCountry, setSelectedCountry] = useState<string[]>([]);
  const [selectedCommodity, setSelectedCommodity] = useState<string[]>([]);
  const [selectedLicenseType, setSelectedLicenseType] = useState<string[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string[]>([]);
  const [selectedEntitySubtype, setSelectedEntitySubtype] = useState<string[]>([]);
  const [selectedSourceLabel, setSelectedSourceLabel] = useState<string[]>([]);
  const [selectedConfidenceBucket, setSelectedConfidenceBucket] = useState<string[]>([]);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [portLinkedOnly, setPortLinkedOnly] = useState(false);
  const [suppliersShowAll, setSuppliersShowAll] = useState(false);
  const filterCacheRef = useRef(new FilterResultCache<MiningLicense[]>());
  const annotationRevisionRef = useRef(0);

  useEffect(() => {
    annotationRevisionRef.current += 1;
    filterCacheRef.current.clear();
  }, [userAnnotations]);

  useEffect(() => {
    filterCacheRef.current.clear();
  }, [rawData]);

  const activeFilterCount =
    selectedCommodity.length +
    selectedCountry.length +
    userStatusFilter.length +
    selectedLicenseType.length +
    selectedEntitySubtype.length +
    selectedSourceLabel.length +
    selectedConfidenceBucket.length +
    (portLinkedOnly ? 1 : 0);

  const resetFilters = () => {
    startTransition(() => {
      setFilter('');
      setAppliedFilter('');
      setSelectedCommodity([]);
      setSelectedCountry([]);
      setUserStatusFilter([]);
      setSelectedLicenseType([]);
      setSelectedEntitySubtype([]);
      setSelectedSourceLabel([]);
      setSelectedConfidenceBucket([]);
      setSelectedSector(null);
      setPortLinkedOnly(false);
      setSuppliersShowAll(false);
    });
  };

  const searchIndex = useMemo(
    () => buildLicenseSearchIndex(rawData, userAnnotations),
    [rawData, userAnnotations],
  );

  const processedData = useMemo(() => {
    const cacheKey = buildProcessedDataCacheKey(
      rawData.length,
      appliedFilter,
      sortBy,
      selectedCountry,
      selectedCommodity,
      selectedLicenseType,
      userStatusFilter,
      selectedEntitySubtype,
      selectedSourceLabel,
      selectedConfidenceBucket,
      selectedSector,
      portLinkedOnly,
      suppliersPipelineMode,
      suppliersShowAll,
      annotationRevisionRef.current,
    );
    const cached = filterCacheRef.current.get(cacheKey);
    if (cached) return cached;

    let data: MiningLicense[] = rawData;

    if (selectedSector) {
      data = data.filter((item) => {
        const itemSector = (item.sector || 'mining').toLowerCase();
        return itemSector === selectedSector.toLowerCase();
      });
    }

    if (selectedCountry.length > 0) {
      data = data.filter((item) => {
        const country = item.country?.trim();
        return country ? selectedCountry.includes(country) : false;
      });
    }

    if (selectedCommodity.length > 0) {
      data = data.filter((item) => {
        const annotation = userAnnotations[item.id] || {};
        const labels = getLicenseCommodityLabels(item.commodity, annotation.commodity);
        return licenseMatchesSelectedCommodities(labels, selectedCommodity);
      });
    }

    if (selectedLicenseType.length > 0) {
      data = data.filter((item) => {
        const annotation = userAnnotations[item.id] || {};
        const val = (annotation.licenseType || item.licenseType || 'Unknown').trim();
        const normalized = val.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return selectedLicenseType.includes(normalized);
      });
    }

    if (selectedEntitySubtype.length > 0) {
      data = data.filter((item) => {
        const subtype = normalizeSubtypeLabel(item.entitySubtype);
        return subtype ? selectedEntitySubtype.includes(subtype) : false;
      });
    }

    if (selectedSourceLabel.length > 0) {
      data = data.filter((item) => {
        const labels = sourceLabelsForItem(item).map((label) => label.toLowerCase());
        return selectedSourceLabel.some((selected) => labels.includes(selected.toLowerCase()));
      });
    }

    if (selectedConfidenceBucket.length > 0) {
      data = data.filter((item) => {
        const bucket = confidenceBucketFromScore(item.confidenceScore);
        return bucket ? selectedConfidenceBucket.includes(bucket) : false;
      });
    }

    if (portLinkedOnly) {
      data = data.filter((item) => Boolean(item.nearbyPort));
    }

    const lower = appliedFilter.trim().toLowerCase();
    if (lower) {
      data = data.filter((item) => licenseHaystackMatches(searchIndex, item.id, lower));
    }

    if (userStatusFilter.length > 0) {
      data = data.filter((item) => {
        const selected = userStatusFilter.map((value) => value.toLowerCase());
        const status = (userAnnotations[item.id]?.status || '').toLowerCase();
        if (selected.includes('unmarked') && !status) return true;
        return Boolean(status) && selected.includes(status);
      });
    }

    if (suppliersPipelineMode) {
      data = data.filter((item) =>
        matchesSuppliersPipeline(userAnnotations[item.id], { showAll: suppliersShowAll }),
      );
    }

    const sorted = data.slice().sort((a, b) => {
      const valA = (a[sortBy] ?? '').toString().toLowerCase();
      const valB = (b[sortBy] ?? '').toString().toLowerCase();
      return valA.localeCompare(valB);
    });

    filterCacheRef.current.set(cacheKey, sorted);
    return sorted;
  }, [
    rawData,
    appliedFilter,
    sortBy,
    selectedCountry,
    selectedCommodity,
    selectedLicenseType,
    userAnnotations,
    userStatusFilter,
    selectedEntitySubtype,
    selectedSourceLabel,
    selectedConfidenceBucket,
    selectedSector,
    portLinkedOnly,
    suppliersPipelineMode,
    suppliersShowAll,
    searchIndex,
  ]);

  const countries = useMemo(() => {
    const c = new Set(
      rawData
        .map((item) => item.country?.trim())
        .filter((country): country is string => Boolean(country)),
    );
    return Array.from(c).sort();
  }, [rawData]);

  const commodities = useMemo(() => {
    const c = new Set<string>();
    for (const item of rawData) {
      const annotation = userAnnotations[item.id] || {};
      const labels = getLicenseCommodityLabels(item.commodity, annotation.commodity);
      for (const label of labels) {
        c.add(label);
      }
    }
    return Array.from(c).sort();
  }, [rawData, userAnnotations]);

  const licenseTypes = useMemo(() => {
    const t = new Set(
      rawData.map((item) => {
        const annotation = userAnnotations[item.id] || {};
        const val = (annotation.licenseType || item.licenseType || 'Unknown').trim();
        return val
          .split(' ')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }),
    );
    return Array.from(t).sort();
  }, [rawData, userAnnotations]);

  const entitySubtypes = useMemo(() => {
    const values = new Set<string>();
    for (const item of rawData) {
      const label = normalizeSubtypeLabel(item.entitySubtype);
      if (label) values.add(label);
    }
    return Array.from(values).sort();
  }, [rawData]);

  const sourceLabels = useMemo(() => {
    const values = new Set<string>();
    for (const item of rawData) {
      for (const label of sourceLabelsForItem(item)) {
        values.add(label);
      }
    }
    return Array.from(values).sort();
  }, [rawData]);

  const infrastructureStats = useMemo(() => {
    const infrastructureItems = processedData.filter(
      (item) => item.entityKind && item.entityKind !== 'license',
    );
    const countries = new Set(infrastructureItems.map((item) => item.country).filter(Boolean));
    const bySubtype: Record<string, number> = {};
    const topCountriesSeed: Record<string, number> = {};
    let ports = 0;
    let withLocode = 0;
    let portLinked = 0;
    let withOperator = 0;
    let withCapacity = 0;
    let highConfidence = 0;

    for (const item of infrastructureItems) {
      const subtype = normalizeSubtypeLabel(item.entitySubtype) || 'Unknown';
      bySubtype[subtype] = (bySubtype[subtype] || 0) + 1;
      if (item.country) topCountriesSeed[item.country] = (topCountriesSeed[item.country] || 0) + 1;
      if (item.entityKind === 'port') ports += 1;
      if (item.locode) withLocode += 1;
      if (item.nearbyPort) portLinked += 1;
      if (item.operatorName) withOperator += 1;
      if (item.capacityText) withCapacity += 1;
      if ((item.confidenceScore || 0) >= 0.8) highConfidence += 1;
    }

    return {
      total: infrastructureItems.length,
      countries: countries.size,
      ports,
      withLocode,
      portLinked,
      withOperator,
      withCapacity,
      highConfidence,
      bySubtype,
      topCountries: Object.entries(topCountriesSeed)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6)
        .map(([country, count]) => ({ country, count })),
    };
  }, [processedData]);

  const setSelectedCountryDeferred = (val: string[]) => {
    startTransition(() => setSelectedCountry(val));
  };
  /** Apply country filter immediately (e.g. map focus) — avoids racing deferred updates. */
  const setSelectedCountryImmediate = useCallback((val: string[]) => {
    setSelectedCountry(val);
  }, []);
  const setSelectedCommodityDeferred = (val: string[]) => {
    startTransition(() => setSelectedCommodity(val));
  };
  const setSelectedLicenseTypeDeferred = (val: string[]) => {
    startTransition(() => setSelectedLicenseType(val));
  };
  const setUserStatusFilterDeferred = (val: string[]) => {
    startTransition(() => setUserStatusFilter(val));
  };
  const setSelectedEntitySubtypeDeferred = (val: string[]) => {
    startTransition(() => setSelectedEntitySubtype(val));
  };
  const setSelectedSourceLabelDeferred = (val: string[]) => {
    startTransition(() => setSelectedSourceLabel(val));
  };
  const setSelectedConfidenceBucketDeferred = (val: string[]) => {
    startTransition(() => setSelectedConfidenceBucket(val));
  };
  const setPortLinkedOnlyDeferred = (val: boolean) => {
    startTransition(() => setPortLinkedOnly(val));
  };

  return {
    processedData,
    countries,
    commodities,
    licenseTypes,
    entitySubtypes,
    sourceLabels,
    infrastructureStats,
    filter,
    appliedFilter,
    setFilter: setFilterDeferred,
    commitSearchFilter,
    sortBy,
    setSortBy,
    selectedCountry,
    setSelectedCountry: setSelectedCountryDeferred,
    setSelectedCountryImmediate,
    selectedCommodity,
    setSelectedCommodity: setSelectedCommodityDeferred,
    selectedLicenseType,
    setSelectedLicenseType: setSelectedLicenseTypeDeferred,
    userStatusFilter,
    setUserStatusFilter: setUserStatusFilterDeferred,
    selectedEntitySubtype,
    setSelectedEntitySubtype: setSelectedEntitySubtypeDeferred,
    selectedSourceLabel,
    setSelectedSourceLabel: setSelectedSourceLabelDeferred,
    selectedConfidenceBucket,
    setSelectedConfidenceBucket: setSelectedConfidenceBucketDeferred,
    selectedSector,
    setSelectedSector,
    portLinkedOnly,
    setPortLinkedOnly: setPortLinkedOnlyDeferred,
    suppliersShowAll,
    setSuppliersShowAll,
    activeFilterCount,
    resetFilters,
    isFilterPending: filter.trim() !== appliedFilter,
  };
};
