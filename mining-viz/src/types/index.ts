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

export interface EntityContact {
  id: string;
  entityKind: string;
  entityId: string;
  contactType: 'phone' | 'email' | 'website' | 'address' | string;
  contactScope?: 'public_business' | 'unknown' | string | null;
  label?: string | null;
  value: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  confidenceScore?: number | null;
  rawPayload?: Record<string, unknown> | null;
  extractedFrom?: string | null;
  verifiedAt?: string | null;
  lastSeenAt?: string | null;
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

export interface MaritimePortReference {
  name: string;
  unlocode?: string | null;
  country_iso2?: string | null;
  subdivision?: string | null;
  lat: number;
  lng: number;
  distance_km?: number | null;
  role?: string | null;
  source_label: string;
  source_url?: string | null;
  confidence?: number | null;
  matched_on?: string | null;
}

export interface MaritimeCompanyLink {
  label: string;
  url: string;
  source_label: string;
  description?: string | null;
  company_name?: string | null;
  confidence?: number | null;
}

export interface MaritimeEvidenceItem {
  id: string;
  title: string;
  url: string;
  source_label: string;
  source_domain?: string | null;
  seen_at?: string | null;
  evidence_type: string;
  confidence: number;
  summary?: string | null;
  matched_terms?: string[];
}

export interface MaritimeIdentity {
  owner?: string | null;
  operator?: string | null;
  flag?: string | null;
  registry_port?: string | null;
  matched_by?: string | null;
  confidence?: number | null;
  source_label: string;
  source_url?: string | null;
}

export interface MaritimeCounterpartyProxy {
  id: string;
  label: string;
  description: string;
  proxy_type: string;
  confidence: number;
  source_label: string;
  url?: string | null;
}

export interface MaritimeContextResponse {
  source_labels: string[];
  data_as_of: string;
  company_links: MaritimeCompanyLink[];
  nearest_ports: MaritimePortReference[];
  evidence: MaritimeEvidenceItem[];
  identity?: MaritimeIdentity | null;
  counterparty_proxies: MaritimeCounterpartyProxy[];
  bol_coverage_note: string;
  limitations: string[];
}

export interface MaritimeVessel {
  id: string;
  mmsi: string;
  vessel_name: string;
  lat: number;
  lng: number;
  observed_at: string;
  source_label: string;
  source_url?: string | null;
  speed_knots?: number | null;
  course_over_ground?: number | null;
  true_heading?: number | null;
  ship_type_code?: number | null;
  ship_type_label?: string | null;
  call_sign?: string | null;
  imo?: string | null;
  destination?: string | null;
  nearest_port?: MaritimePortReference | null;
}

export interface MaritimeVesselFeedResponse {
  vessels: MaritimeVessel[];
  source: string;
  data_as_of: string;
  live_positions_enabled: boolean;
  limitations: string[];
  cached?: boolean;
}

export type CoverageStatus =
  | 'official_syncable'
  | 'official_api_restricted'
  | 'official_portal_only'
  | 'decommissioned'
  | 'unavailable';

export interface CoverageReference {
  name: string;
  url: string;
  access: string;
}

export interface CountrySectorCoverage {
  status: CoverageStatus;
  note: string;
  references: CoverageReference[];
  source_ids: string[];
  record_count: number;
  last_synced_at: string | null;
  fallback_record_count: number;
  fallback_last_synced_at: string | null;
  fallback_sources: string[];
}

export interface AfricaCoverageCountry {
  country: string;
  iso2: string;
  sectors: {
    mining: CountrySectorCoverage;
    oil_and_gas: CountrySectorCoverage;
  };
}

export interface AfricaCoverageResponse {
  generated_at: string;
  summary: Record<'mining' | 'oil_and_gas', Record<string, number>>;
  countries: AfricaCoverageCountry[];
}

