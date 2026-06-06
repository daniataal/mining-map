package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mining-map/oil-live-intel/internal/services/sts"
)

var stsResponseDisclaimer = map[string]any{
	"inference_only": true,
	"status_meaning": "inferred events are AIS proximity matches, not verified commodity transfers",
	"limitations": []string{
		"Connected AIS provider has sparse Persian Gulf / Hormuz / Gulf of Oman coverage",
		"MVP scans the live rolling AIS buffer (~72h), not a full historical archive",
		"Seeded STS zones use approximate open-source polygons",
	},
}

const stsEventSelectSQL = `
	SELECT e.id, e.mmsi_a, e.mmsi_b, e.start_ts, e.end_ts,
		e.centroid_lat, e.centroid_lon, e.min_distance_m, e.avg_sog,
		e.confidence_tier, e.confidence_score, e.status, e.data_source,
		e.evidence, e.metadata, e.zone_id,
		COALESCE(z.name, ''),
		COALESCE(va.name, ''), COALESCE(vb.name, ''),
		COALESCE(va.tanker_class, ''), COALESCE(vb.tanker_class, '')
	FROM oil_sts_events e
	LEFT JOIN oil_sts_zones z ON z.id = e.zone_id
	LEFT JOIN oil_vessels va ON va.mmsi = e.mmsi_a
	LEFT JOIN oil_vessels vb ON vb.mmsi = e.mmsi_b
`

// GetSTSEventsSummary returns cheap count-only STS aggregates for map badges.
func (s *Server) GetSTSEventsSummary(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseTimeRange(r, 72*time.Hour)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	where, args, bboxRaw, err := stsEventsFilterClause(r, from, to)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	var total int
	var lastScan *time.Time
	if err := s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int, MAX(e.updated_at)
		FROM oil_sts_events e
		`+where, args...).Scan(&total, &lastScan); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	byTier := stsEmptyTierCounts()
	rows, err := s.Pool.Query(r.Context(), `
		SELECT e.confidence_tier, COUNT(*)::int
		FROM oil_sts_events e
		`+where+`
		GROUP BY e.confidence_tier
	`, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var tier string
		var count int
		if err := rows.Scan(&tier, &count); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		byTier[tier] = count
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := map[string]any{
		"count":              total,
		"by_confidence_tier": byTier,
		"disclaimer":         stsResponseDisclaimer,
		"last_scan_hint":     stsLastScanHint(lastScan),
		"from":               from.UTC().Format(time.RFC3339),
		"to":                 to.UTC().Format(time.RFC3339),
	}
	if bboxRaw != "" {
		resp["bbox"] = bboxRaw
	}
	writeJSONCached(w, http.StatusOK, resp, 30)
}

// GetSTSEvent returns one STS event with full on-read enrichment (popup/detail).
func (s *Server) GetSTSEvent(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	rows, err := s.Pool.Query(r.Context(), stsEventSelectSQL+`
		WHERE e.id = $1
	`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	scanned, events, err := collectSTSEventRows(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if len(events) == 0 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err := s.applySTSEnrichment(r, scanned, events); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"event":       events[0],
		"disclaimer":  stsResponseDisclaimer,
		"data_source": "ais_proximity",
	}, 60)
}

// ListSTSEvents returns inferred STS proximity events for map/query use.
func (s *Server) ListSTSEvents(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 100)
	if limit > 500 {
		limit = 500
	}
	from, to, err := parseTimeRange(r, 72*time.Hour)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	where, filterArgs, _, err := stsEventsFilterClause(r, from, to)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	args := append(filterArgs, limit)
	q := stsEventSelectSQL + where + ` ORDER BY e.start_ts DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	scanned, events, err := collectSTSEventRows(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if queryBool(r, "enrich", false) {
		if err := s.applySTSEnrichment(r, scanned, events); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"events":      events,
		"count":       len(events),
		"from":        from.UTC().Format(time.RFC3339),
		"to":          to.UTC().Format(time.RFC3339),
		"disclaimer":  stsResponseDisclaimer,
		"data_source": "ais_proximity",
	}, 60)
}

// GetVesselSTSHistory returns STS events involving one MMSI.
func (s *Server) GetVesselSTSHistory(w http.ResponseWriter, r *http.Request) {
	mmsi, err := strconv.ParseInt(chi.URLParam(r, "mmsi"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid mmsi")
		return
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	limit := queryInt(r, "limit", 50)
	if limit > 200 {
		limit = 200
	}
	from, to, err := parseTimeRange(r, 30*24*time.Hour)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	rows, err := s.Pool.Query(r.Context(), stsEventSelectSQL+`
		WHERE (e.mmsi_a = $1 OR e.mmsi_b = $1)
			AND e.end_ts >= $2 AND e.start_ts <= $3
		ORDER BY e.start_ts DESC
		LIMIT $4
	`, mmsi, from, to, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	scanned, events, err := collectSTSEventRows(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.applySTSEnrichment(r, scanned, events); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"mmsi":        mmsi,
		"events":      events,
		"count":       len(events),
		"from":        from.UTC().Format(time.RFC3339),
		"to":          to.UTC().Format(time.RFC3339),
		"disclaimer":  stsResponseDisclaimer,
		"data_source": "ais_proximity",
	}, 60)
}

// PatchSTSEvent lets an analyst upgrade an inferred event to verified (never auto-set).
func (s *Server) PatchSTSEvent(w http.ResponseWriter, r *http.Request) {
	if !s.checkSTSAnalystAuth(r) {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Status            *string `json:"status"`
		ConfidenceTier    *string `json:"confidence_tier"`
		VerificationNotes *string `json:"verification_notes"`
		VerifiedBy        *string `json:"verified_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Status != nil && *body.Status != "verified" {
		writeErr(w, http.StatusBadRequest, "only status=verified is allowed")
		return
	}
	if body.ConfidenceTier != nil && *body.ConfidenceTier != sts.TierVerified {
		writeErr(w, http.StatusBadRequest, "only confidence_tier=verified is allowed")
		return
	}
	verifiedBy := "analyst"
	if body.VerifiedBy != nil && strings.TrimSpace(*body.VerifiedBy) != "" {
		verifiedBy = strings.TrimSpace(*body.VerifiedBy)
	}
	notes := ""
	if body.VerificationNotes != nil {
		notes = strings.TrimSpace(*body.VerificationNotes)
	}
	if s.Pool == nil {
		writeErr(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	verifiedAt := time.Now().UTC().Format(time.RFC3339)
	metaPatch, _ := json.Marshal(map[string]any{
		"verified_by":         verifiedBy,
		"verified_at":         verifiedAt,
		"verification_notes":  notes,
		"verification_source": "analyst_patch",
	})
	tag, err := s.Pool.Exec(r.Context(), `
		UPDATE oil_sts_events SET
			status = 'verified',
			confidence_tier = 'verified',
			metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE id = $1
	`, id, metaPatch)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":                 id.String(),
		"status":             "verified",
		"confidence_tier":    sts.TierVerified,
		"verified_by":        verifiedBy,
		"verified_at":        verifiedAt,
		"verification_notes": notes,
		"disclaimer":         "Analyst-verified STS event — commodity transfer still requires independent cargo evidence.",
	})
}

func (s *Server) checkSTSAnalystAuth(r *http.Request) bool {
	if s.Config.STSAnalystToken == "" {
		return false
	}
	return r.Header.Get("X-Analyst-Token") == s.Config.STSAnalystToken
}

type stsEventScanned struct {
	input sts.EventInput
	item  map[string]any
}

type rowScanner func(dest ...any) error

func collectSTSEventRows(rows pgx.Rows) ([]stsEventScanned, []map[string]any, error) {
	defer rows.Close()
	scanned := make([]stsEventScanned, 0)
	events := make([]map[string]any, 0)
	for rows.Next() {
		item, input, err := scanSTSEventRow(rows.Scan)
		if err != nil {
			return nil, nil, err
		}
		scanned = append(scanned, stsEventScanned{input: input, item: item})
		events = append(events, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return scanned, events, nil
}

func (s *Server) applySTSEnrichment(r *http.Request, scanned []stsEventScanned, events []map[string]any) error {
	if len(scanned) == 0 {
		return nil
	}
	inputs := make([]sts.EventInput, len(scanned))
	for i, row := range scanned {
		inputs[i] = row.input
	}
	enriched, err := sts.EnrichEvents(r.Context(), s.Pool, inputs, sts.DefaultEnrichConfig())
	if err != nil {
		return err
	}
	for i, row := range scanned {
		res, ok := enriched[row.input.ID]
		if !ok {
			continue
		}
		events[i]["linked_port_calls"] = res.LinkedPortCalls
		events[i]["cargo_hypotheses"] = res.CargoHypotheses
		events[i]["enrichment_status"] = res.EnrichmentStatus
		if res.ZoneName != "" {
			events[i]["zone_name"] = res.ZoneName
		}
		events[i]["enrichment_disclaimer"] = "Port calls and cargo rows are contextual hypotheses — not proof of STS commodity transfer."
	}
	return nil
}

func scanSTSEventRow(scan rowScanner) (map[string]any, sts.EventInput, error) {
	var id uuid.UUID
	var mmsiA, mmsiB int64
	var startTS, endTS time.Time
	var centroidLat, centroidLon, minDist, avgSOG *float64
	var tier, status, dataSource string
	var confScore float64
	var evidenceJSON, metadataJSON []byte
	var zoneID *uuid.UUID
	var zoneName, nameA, nameB, classA, classB string

	err := scan(
		&id, &mmsiA, &mmsiB, &startTS, &endTS,
		&centroidLat, &centroidLon, &minDist, &avgSOG,
		&tier, &confScore, &status, &dataSource,
		&evidenceJSON, &metadataJSON, &zoneID,
		&zoneName, &nameA, &nameB, &classA, &classB,
	)
	if err != nil {
		return nil, sts.EventInput{}, err
	}

	var meta map[string]any
	if len(metadataJSON) > 0 {
		_ = json.Unmarshal(metadataJSON, &meta)
	}

	item := map[string]any{
		"id":               id.String(),
		"mmsi_a":           mmsiA,
		"mmsi_b":           mmsiB,
		"start_ts":         startTS.UTC().Format(time.RFC3339),
		"end_ts":           endTS.UTC().Format(time.RFC3339),
		"confidence_tier":  tier,
		"confidence_score": confScore,
		"status":           status,
		"data_source":      dataSource,
		"evidence":         parseEvidenceList(evidenceJSON),
		"vessel_a":         map[string]any{"mmsi": mmsiA, "name": nameA, "tanker_class": classA},
		"vessel_b":         map[string]any{"mmsi": mmsiB, "name": nameB, "tanker_class": classB},
	}
	if centroidLat != nil {
		item["centroid_lat"] = *centroidLat
	}
	if centroidLon != nil {
		item["centroid_lon"] = *centroidLon
	}
	if minDist != nil {
		item["min_distance_m"] = *minDist
	}
	if avgSOG != nil {
		item["avg_sog"] = *avgSOG
	}
	if zoneID != nil {
		item["zone_id"] = zoneID.String()
	}
	if zoneName != "" {
		item["zone_name"] = zoneName
	}
	if meta != nil {
		item["metadata"] = meta
		if vm := sts.ParseVerificationMeta(status, meta); vm != nil {
			if vm.VerifiedBy != "" {
				item["verified_by"] = vm.VerifiedBy
			}
			if vm.VerificationNotes != "" {
				item["verification_notes"] = vm.VerificationNotes
			}
			if !vm.VerifiedAt.IsZero() {
				item["verified_at"] = vm.VerifiedAt.UTC().Format(time.RFC3339)
			}
		}
	}
	input := sts.EventInput{
		ID:       id,
		MMSIA:    mmsiA,
		MMSIB:    mmsiB,
		StartTS:  startTS,
		EndTS:    endTS,
		ZoneName: zoneName,
	}
	return item, input, nil
}

func stsEventsFilterClause(r *http.Request, from, to time.Time) (where string, args []any, bboxRaw string, err error) {
	args = []any{from, to}
	where = `WHERE e.end_ts >= $1 AND e.start_ts <= $2`
	bboxRaw = strings.TrimSpace(r.URL.Query().Get("bbox"))
	if bboxRaw == "" {
		return where, args, "", nil
	}
	minLon, minLat, maxLon, maxLat, ok := parseBBox(bboxRaw)
	if !ok {
		return "", nil, "", errInvalidBBox()
	}
	where += ` AND e.centroid_lon BETWEEN $3 AND $4 AND e.centroid_lat BETWEEN $5 AND $6`
	args = append(args, minLon, maxLon, minLat, maxLat)
	return where, args, bboxRaw, nil
}

func stsEmptyTierCounts() map[string]int {
	return map[string]int{
		sts.TierLow:      0,
		sts.TierMedium:   0,
		sts.TierHigh:     0,
		sts.TierVeryHigh: 0,
		sts.TierVerified: 0,
	}
}

func stsLastScanHint(lastScan *time.Time) string {
	if lastScan == nil || lastScan.IsZero() {
		return "no STS events in range — detector scans live AIS buffer (~72h) every ~30 minutes"
	}
	return lastScan.UTC().Format(time.RFC3339)
}

func errInvalidBBox() error {
	return &bboxParseError{}
}

type bboxParseError struct{}

func (e *bboxParseError) Error() string { return "bbox required: minLon,minLat,maxLon,maxLat" }

func parseTimeRange(r *http.Request, defaultSpan time.Duration) (from, to time.Time, err error) {
	to = time.Now().UTC()
	from = to.Add(-defaultSpan)
	if raw := strings.TrimSpace(r.URL.Query().Get("to")); raw != "" {
		to, err = time.Parse(time.RFC3339, raw)
		if err != nil {
			return from, to, errInvalidTime("to")
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("from")); raw != "" {
		from, err = time.Parse(time.RFC3339, raw)
		if err != nil {
			return from, to, errInvalidTime("from")
		}
	}
	if !from.Before(to) {
		return from, to, errInvalidTime("from must be before to")
	}
	return from, to, nil
}

func errInvalidTime(msg string) error {
	return &timeParseError{msg: msg}
}

type timeParseError struct{ msg string }

func (e *timeParseError) Error() string { return "invalid time: " + e.msg }
