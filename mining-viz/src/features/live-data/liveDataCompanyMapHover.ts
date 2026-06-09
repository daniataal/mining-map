/** Sidebar company hover → map highlight payload. */
export type LiveDataCompanyMapHover = {
  companyId: string;
  lat: number;
  lng: number;
  terminalId?: string;
  name?: string;
};

export type CompanyMapEntityOpenPayload = {
  entityKind: 'terminal' | 'company';
  entityId: string;
  title: string;
  subtitle?: string;
};

export function companyMapHoverUid(hover: LiveDataCompanyMapHover): string {
  return hover.terminalId ? `terminal:${hover.terminalId}` : `company-hover:${hover.companyId}`;
}

export function companyMapHoverFromRecord(company: {
  id: string;
  name: string;
  map_lat?: number;
  map_lng?: number;
  map_terminal_id?: string;
}): LiveDataCompanyMapHover | null {
  if (company.map_lat == null || company.map_lng == null) return null;
  return {
    companyId: company.id,
    name: company.name,
    lat: company.map_lat,
    lng: company.map_lng,
    terminalId: company.map_terminal_id,
  };
}

/** Drawer payload when opening a mappable company from the Companies list. */
export function companyMapEntityOpenPayload(
  company: {
    id: string;
    name: string;
    company_type?: string;
    country?: string;
    map_terminal_id?: string;
  },
  terminal?: {
    name?: string;
    operator_name?: string | null;
    country?: string | null;
  } | null,
): CompanyMapEntityOpenPayload {
  if (company.map_terminal_id) {
    return {
      entityKind: 'terminal',
      entityId: company.map_terminal_id,
      title: terminal?.name ?? company.name,
      subtitle: [terminal?.operator_name ?? company.name, terminal?.country ?? company.country]
        .filter(Boolean)
        .join(' · '),
    };
  }
  return {
    entityKind: 'company',
    entityId: company.id,
    title: company.name,
    subtitle: [company.company_type, company.country].filter(Boolean).join(' · '),
  };
}
