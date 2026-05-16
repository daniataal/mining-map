/** Vessel / AIS types — separate from mining license data. */

export type MaritimeVesselScope = 'oil_tankers' | 'all_vessels';

export interface MaritimeViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface VesselDimensions {
  to_bow?: number;
  to_stern?: number;
  to_port?: number;
  to_starboard?: number;
  length_m?: number;
  width_m?: number;
  raw?: Record<string, unknown>;
}

export interface VesselEta {
  month?: number | null;
  day?: number | null;
  hour?: number | null;
  minute?: number | null;
  raw?: Record<string, unknown>;
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

/** One AISStream message type payload retained from the websocket feed. */
export interface AisMessageEnvelope {
  body: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  received_at?: string;
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
  navigational_status?: number | null;
  navigational_status_label?: string | null;
  rate_of_turn?: number | null;
  position_accuracy?: boolean | null;
  raim?: boolean | null;
  special_manoeuvre_indicator?: number | null;
  ais_timestamp?: number | null;
  communication_state?: number | null;
  ais_valid?: boolean | null;
  ais_version?: number | null;
  maximum_static_draught?: number | null;
  fix_type?: number | null;
  dte?: boolean | null;
  repeat_indicator?: number | null;
  message_id?: number | null;
  assigned_mode?: boolean | null;
  class_b_unit?: boolean | null;
  class_b_display?: boolean | null;
  class_b_dsc?: boolean | null;
  class_b_band?: boolean | null;
  class_b_msg22?: boolean | null;
  communication_state_is_itdma?: boolean | null;
  part_number?: boolean | null;
  raw_type?: number | string | null;
  dimensions?: VesselDimensions | null;
  eta?: VesselEta | null;
  last_message_type?: string | null;
  last_message_at?: string | null;
  message_types_seen?: string[];
  ais_metadata?: Record<string, unknown>;
  ais_messages?: Record<string, AisMessageEnvelope>;
  last_seen_at?: string | null;
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
  offset?: number;
  total_available?: number;
  returned_count?: number;
  cap_applied?: boolean;
  geography_mode?: string;
  geography_note?: string | null;
  requested_bbox?: [number, number, number, number] | null;
  effective_bbox_count?: number;
  region_labels?: string[];
  cached?: boolean;
  stale?: boolean;
  snapshot_age_seconds?: number | null;
  stale_after_seconds?: number;
  worker?: Record<string, unknown>;
}

export interface VesselFilters {
  search: string;
  shipTypes: string[];
  minSpeedKnots: number | null;
  maxSpeedKnots: number | null;
  navigationalStatuses: number[];
}

export const DEFAULT_VESSEL_FILTERS: VesselFilters = {
  search: '',
  shipTypes: [],
  minSpeedKnots: null,
  maxSpeedKnots: null,
  navigationalStatuses: [],
};

export const VESSEL_SHIP_TYPE_OPTIONS = ['Tanker', 'Cargo', 'Passenger', 'Other', 'Unknown'] as const;
