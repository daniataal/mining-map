-- Gulf of Oman / Hormuz approaches — separate from Persian Gulf core box for coverage honesty.
INSERT INTO maritime_watch_zones (
  id, name, priority, min_lat, min_lng, max_lat, max_lng, expected_gap_reason
) VALUES
  (
    'gulf_of_oman_hormuz_approaches',
    'Gulf of Oman / Hormuz approaches',
    15,
    22.5,
    56.0,
    27.5,
    62.5,
    'AISStream terrestrial coverage is sparse east of Hormuz; vessel absence here is often a provider gap, not zero traffic.'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  min_lat = EXCLUDED.min_lat,
  min_lng = EXCLUDED.min_lng,
  max_lat = EXCLUDED.max_lat,
  max_lng = EXCLUDED.max_lng,
  expected_gap_reason = EXCLUDED.expected_gap_reason,
  updated_at = now();
