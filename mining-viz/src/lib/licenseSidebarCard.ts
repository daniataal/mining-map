import type { MiningLicense } from '../types';
import { resolveOilGasOperator } from './oilGasLicensePopup';
import { isUnknownLicenseName } from './licenseVisibility';

/** Prefer real company/operator labels over generic unknown placeholders on sidebar cards. */
export function licenseCardTitle(item: Pick<MiningLicense, 'company' | 'operatorName' | 'ownerName' | 'sourceId' | 'region' | 'country'>): string {
  const company = (item.company || '').trim();
  if (!isUnknownLicenseName(company)) return company;

  const operator = (item.operatorName || '').trim();
  if (operator && !isUnknownLicenseName(operator)) return operator;

  const owner = (item.ownerName || '').trim();
  if (owner && !isUnknownLicenseName(owner)) return owner;

  const fromNote = resolveOilGasOperator(item as MiningLicense);
  if (fromNote && !isUnknownLicenseName(fromNote)) return fromNote;

  const sourceId = (item.sourceId || '').trim();
  if (sourceId) return sourceId;

  const region = (item.region || '').trim();
  const country = (item.country || '').trim();
  if (region && country) return `${region}, ${country}`;
  if (country) return country;
  if (region) return region;

  return 'License record';
}

export function licenseCardHolder(
  item: Pick<MiningLicense, 'company' | 'operatorName' | 'ownerName' | 'licenseType' | 'enrichmentNote'>,
): string | null {
  const holder =
    resolveOilGasOperator(item as MiningLicense) ||
    (item.operatorName || '').trim() ||
    (item.ownerName || '').trim();
  if (!holder || isUnknownLicenseName(holder)) return null;
  const title = licenseCardTitle(item);
  if (holder === title) return null;
  return holder;
}

export function licenseCardStatus(item: Pick<MiningLicense, 'status'>): string | null {
  const status = (item.status || '').trim();
  if (!status || isUnknownLicenseName(status)) return null;
  return status;
}

/** Country · holder · status line for license list cards (MAD-74). */
export function licenseCardSubtitle(item: MiningLicense): string {
  const parts: string[] = [];
  const country = (item.country || '').trim();
  if (country && !isUnknownLicenseName(country)) parts.push(country);

  const holder = licenseCardHolder(item);
  if (holder) parts.push(holder);

  const status = licenseCardStatus(item);
  if (status) parts.push(status);

  if (parts.length === 0) {
    const region = (item.region || '').trim();
    if (region && !isUnknownLicenseName(region)) parts.push(region);
  }

  return parts.length > 0 ? parts.join(' · ') : '—';
}
