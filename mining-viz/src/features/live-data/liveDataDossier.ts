import type { MiningLicense } from '../../types';
import { getOilCompany, type OilCompany } from '../../api/oilLiveApi';

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|corp|co|llc|plc)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Resolve an oil-live company to an existing map license / supplier dossier row. */
export function findDossierLicenseForOilCompany(
  company: Pick<OilCompany, 'id' | 'name' | 'supplier_id'>,
  entityIndex: Record<string, MiningLicense>,
  allLicenses: readonly MiningLicense[],
): MiningLicense | null {
  const supplierId = company.supplier_id?.trim();
  if (supplierId && entityIndex[supplierId]) return entityIndex[supplierId];

  const needle = normalizeCompanyName(company.name);
  if (!needle) return null;

  for (const lic of allLicenses) {
    if (normalizeCompanyName(lic.company) === needle) return lic;
  }
  for (const lic of allLicenses) {
    const hay = normalizeCompanyName(lic.company);
    if (hay.includes(needle) || needle.includes(hay)) return lic;
  }
  return null;
}

export async function fetchOilCompanyForDossier(companyId: string): Promise<OilCompany> {
  return getOilCompany(companyId);
}
