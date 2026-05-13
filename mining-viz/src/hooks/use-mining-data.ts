import { useMemo, useState } from 'react';
import {
  commodityMatchesQuery,
  getLicenseCommodityLabels,
  licenseMatchesSelectedCommodities,
} from '../lib/commodities';
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

export const useMiningData = (rawData: MiningLicense[], userAnnotations: Record<string, UserAnnotation>) => {
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<keyof MiningLicense>('company');
  const [selectedCountry, setSelectedCountry] = useState<string[]>([]);
  const [selectedCommodity, setSelectedCommodity] = useState<string[]>([]);
  const [selectedLicenseType, setSelectedLicenseType] = useState<string[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string[]>([]);
  const [selectedEntitySubtype, setSelectedEntitySubtype] = useState<string[]>([]);
  const [selectedSourceLabel, setSelectedSourceLabel] = useState<string[]>([]);
  const [selectedConfidenceBucket, setSelectedConfidenceBucket] = useState<string[]>([]);
  const [portLinkedOnly, setPortLinkedOnly] = useState(false);
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
    setSelectedCommodity([]);
    setSelectedCountry([]);
    setUserStatusFilter([]);
    setSelectedLicenseType([]);
    setSelectedEntitySubtype([]);
    setSelectedSourceLabel([]);
    setSelectedConfidenceBucket([]);
    setPortLinkedOnly(false);
  };

  const processedData = useMemo(() => {
    let data: MiningLicense[] = rawData;

    if (selectedCountry.length > 0) {
      data = data.filter((item) => {
        const country = item.country?.trim();
        return country ? selectedCountry.includes(country) : false;
      });
    }

    if (selectedCommodity.length > 0) {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const labels = getLicenseCommodityLabels(item.commodity, annotation.commodity);
        return licenseMatchesSelectedCommodities(labels, selectedCommodity);
      });
    }

    if (selectedLicenseType.length > 0) {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const val = (annotation.licenseType || item.licenseType || 'Unknown').trim();
        const normalized = val.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

    if (filter) {
      const lower = filter.toLowerCase();
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const comment = annotation.comment || '';
        const commodity = annotation.commodity || item.commodity || '';
        const operator = item.operatorName || '';
        const portName = item.nearbyPort?.name || '';
        const subtype = item.entitySubtype || '';
        const locode = item.locode || '';

        return (
          (item.company && item.company.toLowerCase().includes(lower)) ||
          (item.licenseType && item.licenseType.toLowerCase().includes(lower)) ||
          operator.toLowerCase().includes(lower) ||
          portName.toLowerCase().includes(lower) ||
          subtype.toLowerCase().includes(lower) ||
          locode.toLowerCase().includes(lower) ||
          (item.country && item.country.toLowerCase().includes(lower)) ||
          commodityMatchesQuery(commodity, lower) ||
          (comment.toLowerCase().includes(lower))
        );
      });
    }

    if (userStatusFilter.length > 0) {
      data = data.filter(item => {
        const selected = userStatusFilter.map((value) => value.toLowerCase());
        const status = (userAnnotations[item.id]?.status || '').toLowerCase();
        if (selected.includes('unmarked') && !status) return true;
        return Boolean(status) && selected.includes(status);
      });
    }

    return data.slice().sort((a, b) => {
      const valA = (a[sortBy] ?? '').toString().toLowerCase();
      const valB = (b[sortBy] ?? '').toString().toLowerCase();
      return valA.localeCompare(valB);
    });
  }, [
    rawData,
    filter,
    sortBy,
    selectedCountry,
    selectedCommodity,
    selectedLicenseType,
    userAnnotations,
    userStatusFilter,
    selectedEntitySubtype,
    selectedSourceLabel,
    selectedConfidenceBucket,
    portLinkedOnly,
  ]);

  const countries = useMemo(() => {
    const c = new Set(
      rawData
        .map((item) => item.country?.trim())
        .filter((country): country is string => Boolean(country))
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
    const t = new Set(rawData.map(item => {
      const annotation = userAnnotations[item.id] || {};
      const val = (annotation.licenseType || item.licenseType || 'Unknown').trim();
      return val.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }));
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
      (item) => item.entityKind && item.entityKind !== 'license'
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

  return {
    processedData,
    countries,
    commodities,
    licenseTypes,
    entitySubtypes,
    sourceLabels,
    infrastructureStats,
    filter,
    setFilter,
    sortBy,
    setSortBy,
    selectedCountry,
    setSelectedCountry,
    selectedCommodity,
    setSelectedCommodity,
    selectedLicenseType,
    setSelectedLicenseType,
    userStatusFilter,
    setUserStatusFilter,
    selectedEntitySubtype,
    setSelectedEntitySubtype,
    selectedSourceLabel,
    setSelectedSourceLabel,
    selectedConfidenceBucket,
    setSelectedConfidenceBucket,
    portLinkedOnly,
    setPortLinkedOnly,
    activeFilterCount,
    resetFilters,
  };
};
