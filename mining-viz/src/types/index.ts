export type LicenseStatus = 'Operating' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | string;

export interface MiningLicense {
  id: string;
  company: string;
  licenseType: string;
  commodity: string;
  sector?: string;
  entityKind?: 'license' | 'storage_terminal' | 'port' | 'logistics_node' | string;
  entitySubtype?:
    | 'tank_farm'
    | 'storage_terminal'
    | 'port'
    | 'terminal'
    | 'rail_terminal'
    | 'logistics_hub'
    | 'depot'
    | string
    | null;
  recordOrigin?: 'open_data' | 'global_open_fallback' | 'bundled_json' | 'manual' | 'csv_import' | 'user_import_csv' | string | null;
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
  sourceKind?: 'official_registry' | 'global_open_fallback' | 'user_import_csv' | 'bundled_json' | 'unknown' | string | null;
  sourceAccess?: string | null;
  coverageState?: string | null;
  provenanceNote?: string | null;
  // Geocoding provenance. Populated by the backend after a backfill run.
  // Frontend only reads these — never write them back from the map UI.
  geoSource?: 'user' | 'csv-import' | 'gazetteer' | 'nominatim' | 'mapbox' | 'manual-fix' | string | null;
  geoApproximated?: boolean | null;
  geoConfidence?: number | null;
  originalLat?: number | null;
  originalLng?: number | null;
  operatorName?: string | null;
  sourceLabels?: string[];
  commodityHints?: string[];
  capacityText?: string | null;
  confidenceScore?: number | null;
  confidenceNote?: string | null;
  nearbyPort?: MaritimePortReference | null;
  evidenceCount?: number | null;
  locode?: string | null;
  countryIso2?: string | null;
  subdivision?: string | null;
}

export interface MarketTickerRow {
  symbol: string;
  price: string;
  category?: string;
  change?: string;
  up?: boolean | null;
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

export interface EntityRelationship {
  id: string;
  sourceEntityKind: string;
  sourceEntityRef: string;
  targetEntityKind?: string | null;
  targetEntityRef?: string | null;
  targetName: string;
  relationshipType: string;
  relationshipLabel?: string | null;
  ownershipPct?: number | null;
  effectiveDate?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  confidenceScore?: number | null;
  rawPayload?: Record<string, unknown> | null;
  extractedFrom?: string | null;
  verifiedAt?: string | null;
  lastSeenAt?: string | null;
}

export interface DdExtractedContact {
  contactType: 'phone' | 'email' | 'website' | 'address' | string;
  value: string;
  label?: string | null;
  contactScope?: 'public_business' | 'private_personal' | 'unknown' | string | null;
  contactRole?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  evidenceSnippet?: string | null;
  extractedFrom?: string | null;
  sourceBasis?: string | null;
  confidence?: number | null;
  verifiedAt?: string | null;
  autoPromoted?: boolean | null;
  promotedContactId?: string | null;
}

export interface DdReport {
  id: string;
  entityKind: string;
  entityId: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  extractionProvider?: string | null;
  extractionModel?: string | null;
  promptVersion?: string | null;
  analysis?: string | null;
  sourceSummary?: {
    sourceName?: string | null;
    sourceUrl?: string | null;
    sourceRecordUrl?: string | null;
    recordOrigin?: string | null;
    lastSyncedAt?: string | null;
  } | null;
  extractedContacts?: DdExtractedContact[];
  promotedContacts?: Array<{
    id: string;
    contactType: string;
    value: string;
    sourceName?: string | null;
    sourceUrl?: string | null;
    sourceType?: string | null;
    confidenceScore?: number | null;
  }>;
  createdAt?: string | null;
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
  relationships: EntityRelationship[];
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

export type MaritimeVesselScope = 'oil_tankers' | 'all_vessels';

export interface MaritimeViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface MaritimeVesselFeedResponse {
  vessels: MaritimeVessel[];
  source: string;
  data_as_of: string;
  live_positions_enabled: boolean;
  limitations: string[];
  scope: MaritimeVesselScope;
  capture_window_seconds: number;
  max_vessels: number;
  geography_mode?: 'viewport_bbox' | 'sampled_viewport_regions' | 'default_regions' | string;
  geography_note?: string | null;
  requested_bbox?: [number, number, number, number] | null;
  effective_bbox_count?: number;
  region_labels?: string[];
  cached?: boolean;
}

export interface StorageEvidenceItem {
  id: string;
  title: string;
  url?: string | null;
  source_label: string;
  evidence_type: string;
  confidence: number;
  summary?: string | null;
}

export interface StorageTerminalDetails extends MiningLicense {
  evidence: StorageEvidenceItem[];
  rawPayload?: Record<string, unknown> | null;
}

export interface StorageTerminalStats {
  total: number;
  countries: number;
  with_operator: number;
  with_capacity: number;
  with_nearby_port: number;
  high_confidence: number;
  by_subtype: Record<string, number>;
  top_countries: Array<{ country: string; count: number }>;
}

export interface StorageTerminalResponse {
  entities: MiningLicense[];
  source_labels: string[];
  data_as_of: string;
  coverage_note: string;
  limitations: string[];
  stats: StorageTerminalStats;
  cached?: boolean;
}

export interface PortInfrastructureLink {
  id: string;
  label: string;
  kind: string;
  distance_km?: number | null;
  source_label: string;
  url?: string | null;
  operator?: string | null;
  cargo?: string | null;
  summary?: string | null;
}

export interface PortLogisticsEvidenceItem {
  id: string;
  title: string;
  url?: string | null;
  source_label: string;
  evidence_type: string;
  confidence: number;
  summary?: string | null;
  seen_at?: string | null;
}

export interface PortLogisticsStats {
  total: number;
  countries: number;
  ports: number;
  with_locode: number;
  with_nearby_port: number;
  high_confidence: number;
  by_subtype: Record<string, number>;
  top_countries: Array<{ country: string; count: number }>;
  map_render_limit: number;
}

export interface PortLogisticsResponse {
  entities: MiningLicense[];
  source_labels: string[];
  data_as_of: string;
  coverage_note: string;
  limitations: string[];
  stats: PortLogisticsStats;
  cached?: boolean;
}

export interface PortLogisticsDetails extends MiningLicense {
  sourceLabels?: string[];
  coverageNote?: string | null;
  dataAsOf?: string | null;
  nearbyInfrastructure: PortInfrastructureLink[];
  evidence: PortLogisticsEvidenceItem[];
  limitations: string[];
  rawPayload?: Record<string, unknown> | null;
}

export type CoverageStatus =
  | 'official_syncable'
  | 'global_fallback_only'
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
  global_fallback_record_count?: number;
  global_fallback_last_synced_at?: string | null;
  global_fallback_sources?: string[];
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

export interface WorldCoverageCountry {
  country: string;
  sectors: {
    mining: CountrySectorCoverage;
    oil_and_gas: CountrySectorCoverage;
  };
}

export interface SourceCatalogEntry {
  source_id: string;
  source_name: string;
  sector: 'mining' | 'oil_and_gas' | string;
  country: string;
  source_url: string;
  source_kind: string;
  source_access: string;
  coverage_state: string;
  coverage_scope: string;
  jurisdiction_scope: string;
  jurisdiction_label?: string | null;
  provenance_note?: string | null;
  note?: string | null;
  record_count: number;
  last_synced_at?: string | null;
  countries_seen?: string[];
}

export interface WorldCoverageResponse {
  generated_at: string;
  summary: Record<'mining' | 'oil_and_gas', Record<string, number>>;
  countries: WorldCoverageCountry[];
  sources: SourceCatalogEntry[];
}

