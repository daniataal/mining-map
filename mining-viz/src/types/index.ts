export type LicenseStatus = 'Operating' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | string;

export interface MiningLicense {
  id: string;
  company: string;
  licenseType: string;
  commodity: string;
  sector?: string;
  recordOrigin?: 'open_data' | 'bundled_json' | 'manual' | 'csv_import' | string | null;
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
  sourceId?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceRecordUrl?: string | null;
  sourceUpdatedAt?: string | null;
  lastSyncedAt?: string | null;
  // Geocoding provenance. Populated by the backend after a backfill run.
  // Frontend only reads these — never write them back from the map UI.
  geoSource?: 'user' | 'csv-import' | 'gazetteer' | 'nominatim' | 'mapbox' | 'manual-fix' | string | null;
  geoApproximated?: boolean | null;
  geoConfidence?: number | null;
  originalLat?: number | null;
  originalLng?: number | null;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  phone_number?: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  details?: string;
  timestamp: string;
}

export type LeadValue = 'high' | 'medium' | 'low';
export type ShipmentStatus = 'planned' | 'in-transit' | 'delivered' | 'cancelled';

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
  leadValue?: LeadValue;
  feeNote?: string;
  [key: string]: any;
}

export interface ShipmentLeg {
  id: string;
  dealId: string;
  dealLabel?: string;
  origin: string;
  destination: string;
  incoterm: string;
  status: ShipmentStatus;
  eta?: string;
  notes?: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  notes?: string;
}

export interface DealChecklist {
  dealId: string;
  items: ChecklistItem[];
  updatedAt: string;
}

export interface MeetingPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MinerListing {
  id: string;
  miner_id: string;
  product: string;
  shape: string;
  quantity: number;
  price_per_kg: number;
  lat: number;
  lng: number;
  photo_url?: string;
  meeting_point_id?: string;
  meeting_date?: string;
  status: 'PENDING' | 'CONTACTED' | 'MEETING' | 'ASSAY' | 'OFFER' | 'ACCEPTED' | 'REJECTED' | 'PURCHASED' | 'TRANSFERRED';
}

// ─── Oil / Petroleum Types ────────────────────────────────────────────────────

export type OilHsCategory = 'crude' | 'refined' | 'gas' | 'other';

export interface OilHsCode {
  code: string;
  description: string;
  category: OilHsCategory;
}

/** Per-country petroleum trade summary returned by /api/oil/summary */
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

