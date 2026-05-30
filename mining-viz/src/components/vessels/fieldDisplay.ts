import type { MaritimeVessel } from '../../lib/vessels/types';

export interface VesselFieldRow {
  key: string;
  label: string;
  value: string;
}

function fmt(value: unknown, fallback = '—'): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function buildVesselFieldGroups(vessel: MaritimeVessel): { title: string; rows: VesselFieldRow[] }[] {
  const dims = vessel.dimensions;
  const eta = vessel.eta;

  return [
    {
      title: 'Identity',
      rows: [
        { key: 'name', label: 'Name', value: fmt(vessel.vessel_name) },
        { key: 'mmsi', label: 'MMSI', value: fmt(vessel.mmsi) },
        { key: 'imo', label: 'IMO', value: fmt(vessel.imo) },
        { key: 'call_sign', label: 'Call sign', value: fmt(vessel.call_sign) },
        { key: 'ship_type_label', label: 'AIS type label', value: fmt(vessel.ship_type_label) },
        { key: 'ship_type_code', label: 'AIS type code', value: fmt(vessel.ship_type_code) },
        { key: 'raw_type', label: 'Raw type code', value: fmt(vessel.raw_type) },
      ],
    },
    {
      title: 'Position',
      rows: [
        { key: 'lat', label: 'Latitude', value: vessel.lat.toFixed(5) },
        { key: 'lng', label: 'Longitude', value: vessel.lng.toFixed(5) },
        { key: 'observed_at', label: 'Observed (UTC)', value: fmt(new Date(vessel.observed_at).toLocaleString()) },
        { key: 'position_accuracy', label: 'Position accuracy', value: fmt(vessel.position_accuracy) },
        { key: 'nearest_port', label: 'Nearest port', value: fmt(vessel.nearest_port?.name) },
        { key: 'unlocode', label: 'UN/LOCODE', value: fmt(vessel.nearest_port?.unlocode) },
      ],
    },
    {
      title: 'Motion',
      rows: [
        { key: 'speed', label: 'Speed (kn)', value: fmt(vessel.speed_knots) },
        { key: 'cog', label: 'Course over ground (°)', value: fmt(vessel.course_over_ground) },
        { key: 'heading', label: 'True heading (°)', value: fmt(vessel.true_heading) },
        { key: 'rot', label: 'Rate of turn', value: fmt(vessel.rate_of_turn) },
        { key: 'nav_status', label: 'Navigational status', value: fmt(vessel.navigational_status_label ?? vessel.navigational_status) },
        { key: 'ais_timestamp', label: 'AIS timestamp (s)', value: fmt(vessel.ais_timestamp) },
      ],
    },
    {
      title: 'Voyage',
      rows: [
        { key: 'destination', label: 'Destination', value: fmt(vessel.destination) },
        {
          key: 'eta',
          label: 'ETA (UTC fields)',
          value: eta
            ? [eta.month, eta.day, eta.hour, eta.minute].map((p) => fmt(p, '?')).join(' / ')
            : '—',
        },
        { key: 'draught', label: 'Max static draught (m)', value: fmt(vessel.maximum_static_draught) },
      ],
    },
    {
      title: 'Dimensions',
      rows: [
        { key: 'length', label: 'Length (m)', value: fmt(dims?.length_m) },
        { key: 'width', label: 'Width (m)', value: fmt(dims?.width_m) },
        { key: 'bow', label: 'To bow (m)', value: fmt(dims?.to_bow) },
        { key: 'stern', label: 'To stern (m)', value: fmt(dims?.to_stern) },
        { key: 'port', label: 'To port (m)', value: fmt(dims?.to_port) },
        { key: 'starboard', label: 'To starboard (m)', value: fmt(dims?.to_starboard) },
      ],
    },
    {
      title: 'AIS radio / flags',
      rows: [
        { key: 'raim', label: 'RAIM', value: fmt(vessel.raim) },
        { key: 'ais_valid', label: 'Valid flag', value: fmt(vessel.ais_valid) },
        { key: 'communication_state', label: 'Communication state', value: fmt(vessel.communication_state) },
        { key: 'communication_state_is_itdma', label: 'ITDMA', value: fmt(vessel.communication_state_is_itdma) },
        { key: 'fix_type', label: 'Fix type', value: fmt(vessel.fix_type) },
        { key: 'ais_version', label: 'AIS version', value: fmt(vessel.ais_version) },
        { key: 'dte', label: 'DTE', value: fmt(vessel.dte) },
        { key: 'special_manoeuvre', label: 'Special manoeuvre', value: fmt(vessel.special_manoeuvre_indicator) },
        { key: 'assigned_mode', label: 'Assigned mode', value: fmt(vessel.assigned_mode) },
        { key: 'repeat_indicator', label: 'Repeat indicator', value: fmt(vessel.repeat_indicator) },
        { key: 'message_id', label: 'Message ID', value: fmt(vessel.message_id) },
      ],
    },
    {
      title: 'Class B (when reported)',
      rows: [
        { key: 'class_b_unit', label: 'Class B unit', value: fmt(vessel.class_b_unit) },
        { key: 'class_b_display', label: 'Class B display', value: fmt(vessel.class_b_display) },
        { key: 'class_b_dsc', label: 'Class B DSC', value: fmt(vessel.class_b_dsc) },
        { key: 'class_b_band', label: 'Class B band', value: fmt(vessel.class_b_band) },
        { key: 'class_b_msg22', label: 'Class B Msg22', value: fmt(vessel.class_b_msg22) },
        { key: 'part_number', label: 'Part number', value: fmt(vessel.part_number) },
      ],
    },
    {
      title: 'Feed',
      rows: [
        { key: 'source', label: 'Source', value: fmt(vessel.source_label) },
        { key: 'provider', label: 'Provider', value: fmt(vessel.provider) },
        { key: 'coverage_confidence', label: 'Coverage confidence', value: fmt(vessel.coverage_confidence) },
        { key: 'region_tags', label: 'Region tags', value: fmt((vessel.region_tags ?? []).join(', ')) },
        { key: 'last_message_type', label: 'Last message type', value: fmt(vessel.last_message_type) },
        { key: 'message_types', label: 'Message types seen', value: fmt((vessel.message_types_seen ?? []).join(', ')) },
        { key: 'last_message_at', label: 'Last message at', value: fmt(vessel.last_message_at) },
        { key: 'last_seen_at', label: 'Snapshot last seen', value: fmt(vessel.last_seen_at) },
      ],
    },
  ];
}
