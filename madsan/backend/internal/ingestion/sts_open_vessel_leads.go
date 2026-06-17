package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const stsOpenVesselLeadsJobType = "sts_open_vessel_leads"

type STSOpenVesselLeadsOptions struct {
	LookbackHours int `json:"lookback_hours,omitempty"`
	Limit         int `json:"limit,omitempty"`
}

type STSOpenVesselLeadsResult struct {
	RowsWritten    int64 `json:"rows_written"`
	DurationMillis int64 `json:"duration_ms"`
}

func (s *Service) processSTSOpenVesselLeads(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := STSOpenVesselLeadsOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.GenerateSTSOpenVesselLeads(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) GenerateSTSOpenVesselLeads(ctx context.Context, opts STSOpenVesselLeadsOptions) (STSOpenVesselLeadsResult, error) {
	started := time.Now()
	if opts.LookbackHours <= 0 {
		opts.LookbackHours = 72
	}
	if opts.Limit <= 0 {
		opts.Limit = 500
	}
	tag, err := s.pool.Exec(ctx, stsOpenVesselLeadsSQL, opts.LookbackHours, opts.Limit)
	return STSOpenVesselLeadsResult{
		RowsWritten:    tag.RowsAffected(),
		DurationMillis: time.Since(started).Milliseconds(),
	}, err
}

const stsOpenVesselLeadsSQL = `
WITH latest AS (
	SELECT DISTINCT ON (a.mmsi)
		a.mmsi,
		a.ts,
		a.lat,
		a.lon,
		a.speed_knots,
		a.nav_status,
		a.draft_m,
		a.destination,
		COALESCE(v.id, ve.vessel_id) AS vessel_id,
		COALESCE(v.name, '') AS vessel_name,
		COALESCE(v.imo, ve.imo, '') AS imo,
		COALESCE(ve.vessel_class, v.vessel_type, '') AS vessel_class,
		COALESCE(ve.owner_name, '') AS owner_name,
		COALESCE(ve.operator_name, '') AS operator_name,
		COALESCE(ve.owner_company_id, NULL) AS owner_company_id,
		COALESCE(ve.operator_company_id, NULL) AS operator_company_id,
		COALESCE(ve.owner_profile, '{}'::jsonb) AS owner_profile
	FROM ais_positions a
	LEFT JOIN vessels v ON v.mmsi = a.mmsi
	LEFT JOIN vessel_enrichment ve ON ve.mmsi = a.mmsi
	WHERE a.ts >= now() - ($1::int * interval '1 hour')
	  AND a.lat IS NOT NULL
	  AND a.lon IS NOT NULL
	ORDER BY a.mmsi, a.ts DESC
),
loiter AS (
	SELECT
		mmsi,
		MIN(ts) AS loiter_start,
		MAX(ts) AS loiter_end,
		AVG(speed_knots) AS avg_speed,
		MIN(draft_m) AS min_draft_m,
		MAX(draft_m) AS max_draft_m
	FROM ais_positions
	WHERE ts >= now() - ($1::int * interval '1 hour')
	  AND COALESCE(speed_knots, 99) < 1.5
	GROUP BY mmsi
),
eligible AS (
	SELECT
		l.*,
		COALESCE(lo.loiter_start, l.ts) AS loiter_start,
		EXTRACT(EPOCH FROM (l.ts - COALESCE(lo.loiter_start, l.ts))) / 3600.0 AS loitering_hours,
		CASE
			WHEN lo.max_draft_m IS NOT NULL AND lo.min_draft_m IS NOT NULL AND lo.max_draft_m > lo.min_draft_m + 0.3 THEN 'loading_trend'
			WHEN lo.max_draft_m IS NOT NULL AND lo.min_draft_m IS NOT NULL AND lo.min_draft_m < lo.max_draft_m - 0.3 THEN 'discharge_trend'
			WHEN COALESCE(l.draft_m, 0) > 0 AND COALESCE(l.draft_m, 0) < 8 THEN 'ballast_clue'
			ELSE 'stable'
		END AS draft_trend,
		CASE
			WHEN UPPER(TRIM(l.destination)) ~ '(FOR[[:space:]]+ORDER|WAITING[[:space:]]+ORDER)' THEN 'waiting-for-orders'
			WHEN UPPER(TRIM(l.destination)) ~ '(^OPL|OFFSHORE|STS)' THEN 'open-to-sts'
			WHEN COALESCE(l.speed_knots, 99) < 1.0 AND COALESCE(lo.loitering_hours, 0) >= 6 THEN 'position-open'
			ELSE 'sts-capable-watch'
		END AS lead_label,
		CASE
			WHEN UPPER(COALESCE(l.vessel_class, '')) ~ '(LNG|LPG)' THEN 'gas'
			WHEN UPPER(COALESCE(l.vessel_class, '')) ~ '(TANKER|VLCC|SUEZ|AFRAMAX|MR|HANDY)' THEN 'crude_or_products'
			ELSE 'unknown'
		END AS product_family,
		COALESCE(NULLIF(TRIM(l.destination), ''), 'open_water') AS zone_label
	FROM latest l
	LEFT JOIN loiter lo ON lo.mmsi = l.mmsi
	WHERE (
		UPPER(TRIM(l.destination)) ~ '(FOR[[:space:]]+ORDER|WAITING[[:space:]]+ORDER|OPL|OFFSHORE|STS)'
		OR (COALESCE(l.speed_knots, 99) < 1.5 AND COALESCE(EXTRACT(EPOCH FROM (l.ts - lo.loiter_start)) / 3600.0, 0) >= 4)
	)
	  AND (
		UPPER(COALESCE(l.vessel_class, '')) ~ '(TANKER|VLCC|SUEZ|AFRAMAX|MR|HANDY|LNG|LPG|GAS)'
		OR l.vessel_id IS NOT NULL
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM port_call_visits pcv
		WHERE pcv.mmsi = l.mmsi
		  AND pcv.status = 'open'
		  AND pcv.arrival_ts >= now() - interval '12 hours'
	  )
),
ranked AS (
	SELECT
		*,
		LEAST(95,
			35
			+ CASE WHEN UPPER(TRIM(destination)) ~ '(FOR[[:space:]]+ORDER|WAITING[[:space:]]+ORDER)' THEN 25 ELSE 0 END
			+ CASE WHEN UPPER(TRIM(destination)) ~ '(OPL|STS|OFFSHORE)' THEN 15 ELSE 0 END
			+ CASE WHEN loitering_hours >= 12 THEN 15 WHEN loitering_hours >= 6 THEN 8 ELSE 0 END
			+ CASE WHEN owner_name <> '' THEN 10 ELSE 0 END
		) AS confidence_score
	FROM eligible
	ORDER BY confidence_score DESC, loitering_hours DESC NULLS LAST
	LIMIT $2
)
INSERT INTO sts_open_vessel_leads (
	vessel_id, mmsi, imo, vessel_name, vessel_class, zone_label,
	latest_destination, nav_status, loitering_hours, latest_draft_m, draft_trend,
	product_family, owner_name, operator_name, owner_company_id, operator_company_id,
	contacts, lead_label, confidence_score, evidence_labels, evidence, limitations,
	lat, lon, generated_at, expires_at
)
SELECT
	vessel_id,
	mmsi,
	NULLIF(imo, ''),
	NULLIF(vessel_name, ''),
	NULLIF(vessel_class, ''),
	zone_label,
	NULLIF(TRIM(destination), ''),
	nav_status,
	ROUND(loitering_hours::numeric, 2),
	draft_m,
	draft_trend,
	product_family,
	NULLIF(owner_name, ''),
	NULLIF(operator_name, ''),
	owner_company_id,
	operator_company_id,
	CASE
		WHEN owner_profile <> '{}'::jsonb THEN jsonb_build_array(jsonb_build_object('source', 'vessel_enrichment', 'profile', owner_profile))
		ELSE '[]'::jsonb
	END,
	lead_label,
	ROUND(confidence_score::numeric, 2),
	ARRAY['observed', 'inferred']::text[],
	jsonb_build_array(
		jsonb_build_object('label', 'observed', 'source', 'ais_positions', 'field', 'destination', 'value', destination),
		jsonb_build_object('label', 'observed', 'source', 'ais_positions', 'field', 'speed_knots', 'value', speed_knots),
		jsonb_build_object('label', 'inferred', 'source', 'ais_loitering', 'loitering_hours', loitering_hours)
	),
	ARRAY[
		'Open-to-STS lead from AIS destination keywords and loitering; buyer and cargo owner are not confirmed.',
		'Owner contacts are enrichment clues — verify registry and sanctions before outreach.',
		'Persian Gulf / Hormuz AIS coverage may be sparse depending on connected provider.'
	],
	lat,
	lon,
	now(),
	now() + interval '18 hours'
FROM ranked
ON CONFLICT (mmsi) DO UPDATE SET
	vessel_id = EXCLUDED.vessel_id,
	imo = EXCLUDED.imo,
	vessel_name = EXCLUDED.vessel_name,
	vessel_class = EXCLUDED.vessel_class,
	zone_label = EXCLUDED.zone_label,
	latest_destination = EXCLUDED.latest_destination,
	nav_status = EXCLUDED.nav_status,
	loitering_hours = EXCLUDED.loitering_hours,
	latest_draft_m = EXCLUDED.latest_draft_m,
	draft_trend = EXCLUDED.draft_trend,
	product_family = EXCLUDED.product_family,
	owner_name = EXCLUDED.owner_name,
	operator_name = EXCLUDED.operator_name,
	owner_company_id = EXCLUDED.owner_company_id,
	operator_company_id = EXCLUDED.operator_company_id,
	contacts = EXCLUDED.contacts,
	lead_label = EXCLUDED.lead_label,
	confidence_score = EXCLUDED.confidence_score,
	evidence_labels = EXCLUDED.evidence_labels,
	evidence = EXCLUDED.evidence,
	limitations = EXCLUDED.limitations,
	lat = EXCLUDED.lat,
	lon = EXCLUDED.lon,
	generated_at = EXCLUDED.generated_at,
	expires_at = EXCLUDED.expires_at
`
