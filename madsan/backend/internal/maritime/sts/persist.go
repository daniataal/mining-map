package sts

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/intelligence"
)

func persistSTSSignal(ctx context.Context, pool *pgxpool.Pool, c Candidate, metaA, metaB VesselMeta, zoneID *uuid.UUID, zoneName string, inZone, bothTankers bool, eventCtx CandidateContext) error {
	durationH := c.EndTS.Sub(c.StartTS).Hours()
	eventLat, eventLon := candidateEventPoint(c)
	closestTS := ""
	if !c.ClosestTS.IsZero() {
		closestTS = c.ClosestTS.UTC().Format(time.RFC3339)
	}
	probInput := intelligence.STSProbabilityInput{
		MinDistanceM:         c.MinDistanceM,
		DurationHours:        durationH,
		AvgSOG:               c.AvgSOG,
		DistanceVarianceM:    eventCtx.DistanceVarianceM,
		BothTankers:          bothTankers,
		MixedTankerClasses:   mixedTankerClasses(metaA.TankerClass, metaB.TankerClass),
		InSTSZone:            inZone,
		ZoneName:             zoneName,
		OverlappingPortCalls: eventCtx.OverlappingPortCalls,
		CrowdingVesselCount:  eventCtx.CrowdingVessels,
		SpoofClusterVessels:  eventCtx.SpoofClusterVessels,
		PartnerDegree:        eventCtx.PartnerDegree,
		PositionOnLand:       eventCtx.OnLand && !eventCtx.NearInlandWater,
	}
	if eventCtx.MaritimeContext != nil {
		probInput.MaritimeContextType = eventCtx.MaritimeContext.Kind
		probInput.MaritimeContextName = eventCtx.MaritimeContext.Name
		probInput.MaritimeContextDistanceM = eventCtx.MaritimeContext.DistanceM
	}
	if eventCtx.NearestTerminal != nil {
		probInput.NearestTerminalName = eventCtx.NearestTerminal.Name
		probInput.NearestTerminalDistanceM = eventCtx.NearestTerminal.DistanceM
	}
	probability := intelligence.ScoreSTSProbability(probInput)
	proximity := intelligence.ScoreSTS(intelligence.STSScoreInput{
		MinDistanceM:     c.MinDistanceM,
		DurationHours:    durationH,
		AvgSOG:           c.AvgSOG,
		DistanceVariance: eventCtx.DistanceVarianceM,
		BothTankers:      bothTankers,
		InSTSZone:        inZone,
		OutsideTerminal:  true,
		ZoneName:         zoneName,
	})

	pairKey := fmt.Sprintf("%s:%s:%d", c.MMSIA, c.MMSIB, c.StartTS.UTC().Unix())
	payload, _ := json.Marshal(map[string]any{
		"sts_pair_key":           pairKey,
		"mmsi_a":                 c.MMSIA,
		"mmsi_b":                 c.MMSIB,
		"vessel_a_name":          metaA.Name,
		"vessel_b_name":          metaB.Name,
		"vessel_a_class":         metaA.TankerClass,
		"vessel_b_class":         metaB.TankerClass,
		"start_ts":               c.StartTS.UTC().Format(time.RFC3339),
		"end_ts":                 c.EndTS.UTC().Format(time.RFC3339),
		"duration_hours":         durationH,
		"event_lat":              eventLat,
		"event_lon":              eventLon,
		"closest_approach_lat":   c.ClosestLat,
		"closest_approach_lon":   c.ClosestLon,
		"closest_approach_ts":    closestTS,
		"centroid_lat":           c.CentroidLat,
		"centroid_lon":           c.CentroidLon,
		"min_distance_m":         c.MinDistanceM,
		"avg_sog":                c.AvgSOG,
		"sample_buckets":         c.SampleBuckets,
		"zone_id":                zoneIDStr(zoneID),
		"zone_name":              zoneName,
		"score":                  proximity,
		"probability":            probability,
		"proximity_score":        probability.ProximityScore,
		"transfer_probability":   probability.TransferProbability,
		"cargo_confidence":       probability.CargoConfidence,
		"context_label":          probability.ContextLabel,
		"review_tier":            probability.ReviewTier,
		"downgrade_reasons":      probability.DowngradeReasons,
		"maritime_context":       contextPayload(eventCtx.MaritimeContext),
		"nearest_oil_terminal":   contextPayload(eventCtx.NearestTerminal),
		"overlapping_port_calls": eventCtx.OverlappingPortCalls,
		"crowding_vessels":       eventCtx.CrowdingVessels,
		"spoof_cluster_vessels":  eventCtx.SpoofClusterVessels,
		"gps_spoofing_suspected": probInput.PositionOnLand || eventCtx.SpoofClusterVessels >= 4,
		"position_on_land":       probInput.PositionOnLand,
		"partner_degree":         eventCtx.PartnerDegree,
		"distance_variance_m":    eventCtx.DistanceVarianceM,
		"detector":               "ais_proximity_v2",
		"positions_table":        "ais_positions",
		"disclaimer":             probability.Disclaimer,
		"limitations":            probability.Limitations,
	})

	entityID := metaA.ID
	if entityID == uuid.Nil {
		entityID = metaB.ID
	}
	if entityID == uuid.Nil {
		return nil
	}

	tag, err := pool.Exec(ctx, `
		UPDATE core_signals SET
			confidence_score = $1::numeric,
			tier = 'observed',
			payload = $2::jsonb,
			observed_at = now()
		WHERE signal_type = 'sts' AND payload->>'sts_pair_key' = $3::text
		`, probability.TransferProbability, payload, pairKey)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload)
		VALUES ('vessel', $1::uuid, 'sts', 'observed', $2::numeric, $3::jsonb)
		`, entityID, probability.TransferProbability, payload)
	return err
}

func zoneIDStr(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

func contextPayload(match *ContextMatch) any {
	if match == nil {
		return nil
	}
	return map[string]any{
		"id":         match.ID.String(),
		"name":       match.Name,
		"kind":       match.Kind,
		"distance_m": match.DistanceM,
	}
}
