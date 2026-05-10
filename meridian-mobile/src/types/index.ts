export type LicenseStatus = 'Operating' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | string;

export interface MiningLicense {
  id: string;
  company: string;
  licenseType: string;
  commodity: string;
  status: LicenseStatus;
  date: string | null;
  country: string;
  region: string;
  lat: number;
  lng: number;
  phoneNumber?: string | null;
  contactPerson?: string | null;
  pricePerKg?: number;
  capacity?: number;
  isExported?: boolean;
  geoSource?: string | null;
  geoApproximated?: boolean | null;
  geoConfidence?: number | null;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  phone_number?: string;
  created_at: string;
}

export interface UserAnnotation {
  status?: LicenseStatus;
  stage?: string;
  comment?: string;
  notes?: string;
  commodity?: string;
  licenseType?: string;
  price?: number;
  quantity?: number;
  contactPerson?: string;
  phoneNumber?: string;
  leadValue?: 'high' | 'medium' | 'low';
  [key: string]: any;
}

export type OilHsCategory = 'crude' | 'refined' | 'gas' | 'other';

export interface OilTradeFlow {
  country: string;
  iso2: string;
  lat: number;
  lng: number;
  export_value_usd: number | null;
  import_value_usd: number | null;
  top_hs_code: string;
  top_hs_description: string;
  category: OilHsCategory;
  year: number;
  rank?: number;
}

export interface OilSummaryResponse {
  flows: OilTradeFlow[];
  source: string;
  data_as_of: string;
  limitations: string[];
}
