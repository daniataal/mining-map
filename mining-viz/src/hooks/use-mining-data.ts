import { useMemo, useState } from 'react';
import {
  commodityMatchesQuery,
  getLicenseCommodityLabels,
  licenseMatchesSelectedCommodities,
} from '../lib/commodities';
import { MiningLicense, UserAnnotation } from '../types';

export const useMiningData = (rawData: MiningLicense[], userAnnotations: Record<string, UserAnnotation>) => {
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<keyof MiningLicense>('company');
  const [selectedCountry, setSelectedCountry] = useState<string[]>([]);
  const [selectedCommodity, setSelectedCommodity] = useState<string[]>([]);
  const [selectedLicenseType, setSelectedLicenseType] = useState<string[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<string[]>([]);

  const processedData = useMemo(() => {
    let data = [...rawData];

    if (selectedCountry.length > 0) {
      data = data.filter(item => selectedCountry.includes(item.country || 'Ghana'));
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

    if (filter) {
      const lower = filter.toLowerCase();
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const comment = annotation.comment || '';
        const commodity = annotation.commodity || item.commodity || '';

        return (
          (item.company && item.company.toLowerCase().includes(lower)) ||
          (item.licenseType && item.licenseType.toLowerCase().includes(lower)) ||
          commodityMatchesQuery(commodity, lower) ||
          (comment.toLowerCase().includes(lower))
        );
      });
    }

    if (userStatusFilter.length > 0) {
      data = data.filter(item => {
        const status = userAnnotations[item.id]?.status;
        if (userStatusFilter.includes('unmarked') && !status) return true;
        return status && userStatusFilter.includes(status);
      });
    }

    return data.sort((a, b) => {
      const valA = (a[sortBy] ?? '').toString().toLowerCase();
      const valB = (b[sortBy] ?? '').toString().toLowerCase();
      return valA.localeCompare(valB);
    });
  }, [rawData, filter, sortBy, selectedCountry, selectedCommodity, selectedLicenseType, userAnnotations, userStatusFilter]);

  const countries = useMemo(() => {
    const c = new Set(rawData.map(item => item.country || 'Ghana'));
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

  return {
    processedData,
    countries,
    commodities,
    licenseTypes,
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
  };
};
