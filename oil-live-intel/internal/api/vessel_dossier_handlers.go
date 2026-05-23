package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mining-map/oil-live-intel/internal/services/vesselmerge"
)

// GetVesselDossier returns AIS position, port calls, linked MCR rows, and party candidates for one MMSI.
func (s *Server) GetVesselDossier(w http.ResponseWriter, r *http.Request) {
	mmsi, err := strconv.ParseInt(chi.URLParam(r, "mmsi"), 10, 64)
	if err != nil || mmsi <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid mmsi")
		return
	}
	excludeSeed := queryBool(r, "exclude_seed", s.Config.DisableDemoSeed)
	portCallLimit := queryInt(r, "port_call_limit", 15)
	mcrLimit := queryInt(r, "mcr_limit", 20)
	if mcrLimit > 100 {
		mcrLimit = 100
	}
	mcrOffset := queryOffset(r, "mcr_offset")

	ctx := r.Context()
	vesselMeta, _ := s.lookupVesselRegistry(ctx, mmsi)
	position, posErr := s.lookupVesselLatestPosition(ctx, mmsi)
	if posErr != nil {
		writeErr(w, http.StatusInternalServerError, posErr.Error())
		return
	}

	portCalls, err := s.listPortCallsForMMSI(ctx, mmsi, portCallLimit, excludeSeed)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	mcrTotal, err := s.countCargoForMMSI(ctx, mmsi, excludeSeed)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	cargoRows, err := s.listCargoForMMSI(ctx, mmsi, mcrLimit, mcrOffset, excludeSeed)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	parties := deriveVesselParties(cargoRows)

	out := map[string]any{
		"mmsi":       mmsi,
		"vessel":     vesselMeta,
		"position":   position,
		"port_calls": portCalls,
		"cargo_records": map[string]any{
			"items":  cargoRows,
			"total":  mcrTotal,
			"limit":  mcrLimit,
			"offset": mcrOffset,
		},
		"parties": parties,
		"disclaimer": "AIS and inferred port activity do not confirm supplier or receiver. MCR rows are synthetic hypotheses from public sources.",
	}
	if len(portCalls) == 0 && position == nil && len(cargoRows) == 0 {
		out["empty_state"] = "no_stored_rows_for_mmsi"
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) lookupVesselRegistry(ctx context.Context, mmsi int64) (map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT mmsi, imo, name, vessel_type, tanker_class, crude_capable, product_tanker,
			deadweight_tons, max_draft_m, metadata, updated_at
		FROM oil_vessels WHERE mmsi=$1
	`, mmsi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return map[string]any{"mmsi": mmsi}, nil
	}
	var imo, name, vtype, tclass *string
	var crude, product *bool
	var dwt, mdraft *float64
	var meta []byte
	var updated time.Time
	if err := rows.Scan(&mmsi, &imo, &name, &vtype, &tclass, &crude, &product, &dwt, &mdraft, &meta, &updated); err != nil {
		return nil, err
	}
	var metaMap map[string]any
	_ = json.Unmarshal(meta, &metaMap)
	item := map[string]any{
		"mmsi": mmsi, "imo": imo, "name": name, "vessel_type": vtype, "tanker_class": tclass,
		"crude_capable": crude, "product_tanker": product, "deadweight_tons": dwt,
		"max_draft_m": mdraft, "updated_at": updated, "metadata": metaMap,
	}
	return item, nil
}

func (s *Server) lookupVesselLatestPosition(ctx context.Context, mmsi int64) (map[string]any, error) {
	if vesselmerge.TableReady(ctx, s.Pool) && vesselmerge.MergedPositionsEnabled() {
		pos, err := s.lookupMergedPosition(ctx, mmsi)
		if err != nil {
			return nil, err
		}
		if pos != nil {
			return pos, nil
		}
	}
	return s.lookupLegacyAisPosition(ctx, mmsi)
}

func (s *Server) lookupMergedPosition(ctx context.Context, mmsi int64) (map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		WITH latest AS (
		  SELECT DISTINCT ON (o.data_source)
		    o.mmsi,
		    COALESCE(NULLIF(o.source, ''), o.data_source) AS source,
		    o.data_source,
		    COALESCE(NULLIF(o.source_type, ''), o.data_source) AS source_type,
		    o.imo,
		    o.lat,
		    o.lng,
		    o.sog,
		    o.cog,
		    o.vessel_name,
		    COALESCE(o.position_time, o.observed_at) AS position_time,
		    o.confidence,
		    o.source_url,
		    o.raw
		  FROM oil_vessel_position_observations o
		  WHERE o.mmsi = $1
		    AND COALESCE(o.position_time, o.observed_at) > now() - interval '7 days'
		  ORDER BY o.data_source, COALESCE(o.position_time, o.observed_at) DESC
		),
		ranked AS (
		  SELECT *,
		    CASE LOWER(source)
		      WHEN 'live_ais' THEN 0
		      WHEN 'aisstream' THEN 1
		      WHEN 'aisstream_snapshot' THEN 1
		      WHEN 'aishub' THEN 1
		      WHEN 'barentswatch' THEN 2
		      WHEN 'denmark_ais' THEN 2
		      WHEN 'maritime_redis' THEN 3
		      WHEN 'inferred_port_call' THEN 4
		      ELSE 6
		    END AS src_rank
		  FROM latest
		)
		SELECT mmsi, source, data_source, source_type, imo, lat, lng, sog, cog,
		  vessel_name, position_time, confidence, source_url, raw
		FROM ranked
		ORDER BY src_rank ASC, position_time DESC
		LIMIT 1
	`, mmsi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	return scanDossierPosition(rows)
}

func (s *Server) lookupLegacyAisPosition(ctx context.Context, mmsi int64) (map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT p.mmsi, p.lat, p.lng, p.speed, p.course, p.draft_m, p.ts,
			COALESCE(v.name, '') AS vessel_name
		FROM oil_ais_positions p
		LEFT JOIN oil_vessels v ON v.mmsi = p.mmsi
		WHERE p.mmsi = $1
		ORDER BY p.ts DESC NULLS LAST
		LIMIT 1
	`, mmsi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	var lat, lng float64
	var speed, course, draft *float64
	var ts time.Time
	var name string
	if err := rows.Scan(&mmsi, &lat, &lng, &speed, &course, &draft, &ts, &name); err != nil {
		return nil, err
	}
	item := map[string]any{
		"mmsi": mmsi, "lat": lat, "lng": lng, "position_time": ts,
		"source": "live_ais", "data_source": "oil_ais_positions", "source_type": "ais",
		"bol_tier": "live", "data_provenance": "live_ais",
		"freshness_seconds": int(time.Since(ts).Seconds()),
	}
	if speed != nil {
		item["speed"] = *speed
	}
	if course != nil {
		item["course"] = *course
	}
	if draft != nil {
		item["draft_m"] = *draft
	}
	if strings.TrimSpace(name) != "" {
		item["vessel_name"] = name
	}
	return item, nil
}

type dossierPositionScanner interface {
	Scan(dest ...any) error
}

func scanDossierPosition(rows dossierPositionScanner) (map[string]any, error) {
	var mmsi int64
	var source, dataSource, sourceType string
	var imo, vesselName *string
	var lat, lng float64
	var sog, cog, confidence *float64
	var sourceURL *string
	var raw []byte
	var observed time.Time
	if err := rows.Scan(&mmsi, &source, &dataSource, &sourceType, &imo, &lat, &lng, &sog, &cog,
		&vesselName, &observed, &confidence, &sourceURL, &raw); err != nil {
		return nil, err
	}
	tier := positionBolTier(source, dataSource)
	item := map[string]any{
		"mmsi": mmsi, "lat": lat, "lng": lng, "position_time": observed,
		"source": source, "data_source": dataSource, "source_type": sourceType,
		"imo": imo, "vessel_name": vesselName,
		"bol_tier": tier, "data_provenance": source,
		"confidence": confidence, "source_url": sourceURL,
		"freshness_seconds": int(time.Since(observed).Seconds()),
	}
	if sog != nil {
		item["speed"] = *sog
	}
	if cog != nil {
		item["course"] = *cog
	}
	if len(raw) > 0 {
		var rawMap map[string]any
		if json.Unmarshal(raw, &rawMap) == nil {
			item["raw"] = rawMap
		}
	}
	return item, nil
}

func positionBolTier(source, dataSource string) string {
	s := strings.ToLower(strings.TrimSpace(source))
	ds := strings.ToLower(strings.TrimSpace(dataSource))
	if s == "live_ais" || ds == "live_ais" || strings.Contains(ds, "ais") {
		return "live"
	}
	if strings.Contains(s, "inferred") || strings.Contains(ds, "inferred") {
		return "inferred"
	}
	return "live"
}

func (s *Server) listPortCallsForMMSI(ctx context.Context, mmsi int64, limit int, excludeSeed bool) ([]map[string]any, error) {
	q := `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, t.name AS terminal_name,
			pc.arrival_ts, pc.departure_ts, pc.duration_hours, pc.event_type,
			pc.product_family_inferred, pc.estimated_volume_barrels, pc.confidence, pc.status,
			pc.evidence, pc.metadata, t.operator_name, t.country
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.mmsi = $1
	`
	args := []any{mmsi}
	if excludeSeed {
		q += `
			AND NOT (
				COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
				OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
			)
		`
	}
	q += ` ORDER BY COALESCE(pc.departure_ts, pc.arrival_ts) DESC NULLS LAST LIMIT $2`
	args = append(args, limit)

	rows, err := s.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]any
	for rows.Next() {
		var pid, tid uuid.UUID
		var mmsiRow int64
		var vessel, tname, event, family, status, op, country *string
		var arrival, departure *time.Time
		var dur, vol, conf *float64
		var evidence, metadata []byte
		if err := rows.Scan(&pid, &mmsiRow, &vessel, &tid, &tname, &arrival, &departure, &dur, &event, &family, &vol, &conf, &status, &evidence, &metadata, &op, &country); err != nil {
			return nil, err
		}
		provenance := inferPortCallProvenance(evidence, metadata)
		item := map[string]any{
			"id": pid.String(), "mmsi": mmsiRow, "vessel_name": vessel,
			"terminal_id": tid.String(), "terminal_name": tname,
			"operator_name": op, "country": country,
			"arrival_ts": arrival, "departure_ts": departure, "duration_hours": dur,
			"event_type": event, "product_family_inferred": family,
			"estimated_volume_barrels": vol, "confidence": conf, "status": status,
			"bol_tier": portCallBolTier(provenance), "data_provenance": provenance,
			"evidence": parseEvidenceList(evidence),
			"metadata": parseMetadataMap(metadata),
			"source_links": extractSourceLinks(evidence, metadata),
			"disclaimer": "Inferred from public/free data. Not a confirmed private transaction.",
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func portCallBolTier(provenance string) string {
	switch strings.TrimSpace(provenance) {
	case "live_ais":
		return "live"
	case "seed_port_calls", "synthetic":
		return "synthetic"
	default:
		return "inferred"
	}
}

func (s *Server) countCargoForMMSI(ctx context.Context, mmsi int64, excludeSeed bool) (int, error) {
	q := `
		SELECT COUNT(*)::int
		FROM meridian_cargo_records m
		LEFT JOIN oil_port_calls pc ON pc.id = m.port_call_id
		WHERE m.mmsi = $1
	`
	if excludeSeed {
		q += `
			AND NOT (
				COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
				OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
			)
		`
	}
	var n int
	err := s.Pool.QueryRow(ctx, q, mmsi).Scan(&n)
	return n, err
}

func (s *Server) listCargoForMMSI(ctx context.Context, mmsi int64, limit, offset int, excludeSeed bool) ([]map[string]any, error) {
	q := `
		SELECT m.id, m.synthetic_bol_id, m.recipe, m.commodity_family, m.confidence, m.triangulation_score,
			m.bol_tier, m.shipper_name, m.consignee_name, m.shipper_company_id, m.consignee_company_id,
			m.vessel_name, m.mmsi, m.imo, m.load_port_name, m.load_country, m.discharge_hint, m.discharge_country,
			m.volume_low, m.volume_high, m.volume_best_estimate, m.volume_unit,
			m.event_date, m.evidence_chain, m.sources,
			COALESCE(m.shipper_lei, NULL), COALESCE(m.consignee_lei, NULL),
			COALESCE(m.shipper_sanctions_status, NULL), COALESCE(m.consignee_sanctions_status, NULL),
			pc.evidence, pc.metadata
		FROM meridian_cargo_records m
		LEFT JOIN oil_port_calls pc ON pc.id = m.port_call_id
		WHERE m.mmsi = $1
	`
	if excludeSeed {
		q += `
			AND NOT (
				COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
				OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
			)
		`
	}
	q += ` ORDER BY m.triangulation_score DESC NULLS LAST, m.confidence DESC, m.event_date DESC NULLS LAST`
	q += fmt.Sprintf(` LIMIT %d OFFSET %d`, limit, offset)

	rows, err := s.Pool.Query(ctx, q, mmsi)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var bolID, recipe, family, tier string
		var shipper, consignee, vessel, imo, loadPort, loadCountry, discharge, dischargeCountry *string
		var shipperCID, consigneeCID *uuid.UUID
		var mmsiVal *int64
		var conf float64
		var tri int
		var volLow, volHigh, volBest *float64
		var volUnit *string
		var eventDate *time.Time
		var evidenceChain, sources []byte
		var shipperLEI, consigneeLEI *string
		var shipperSanctions, consigneeSanctions *string
		var pcEvidence, pcMetadata []byte
		if err := rows.Scan(&id, &bolID, &recipe, &family, &conf, &tri, &tier,
			&shipper, &consignee, &shipperCID, &consigneeCID, &vessel, &mmsiVal, &imo,
			&loadPort, &loadCountry, &discharge, &dischargeCountry,
			&volLow, &volHigh, &volBest, &volUnit, &eventDate,
			&evidenceChain, &sources,
			&shipperLEI, &consigneeLEI, &shipperSanctions, &consigneeSanctions,
			&pcEvidence, &pcMetadata); err != nil {
			return nil, err
		}
		provenance := inferCargoProvenance(tier)
		if portProv := inferPortCallProvenance(pcEvidence, pcMetadata); portProv != "unknown" {
			provenance = portProv
		}
		var evChain, srcList any
		_ = json.Unmarshal(evidenceChain, &evChain)
		_ = json.Unmarshal(sources, &srcList)
		item := map[string]any{
			"id": id.String(), "synthetic_bol_id": bolID, "recipe": recipe,
			"commodity_family": family, "confidence": conf, "triangulation_score": tri,
			"bol_tier": tier, "data_provenance": provenance,
			"shipper_name": shipper, "consignee_name": consignee,
			"vessel_name": vessel, "mmsi": mmsiVal, "imo": imo,
			"load_port_name": loadPort, "load_country": loadCountry,
			"discharge_hint": discharge, "discharge_country": dischargeCountry,
			"volume_low": volLow, "volume_high": volHigh, "volume_best_estimate": volBest,
			"volume_unit": volUnit, "event_date": formatTimePtr(eventDate),
			"evidence_chain": evChain, "sources": srcList,
			"shipper_lei": shipperLEI, "consignee_lei": consigneeLEI,
			"shipper_sanctions_status": shipperSanctions, "consignee_sanctions_status": consigneeSanctions,
			"disclaimer": "Synthetic cargo record — inferred from public sources, not a legal BOL.",
		}
		if shipperCID != nil {
			item["shipper_company_id"] = shipperCID.String()
		}
		if consigneeCID != nil {
			item["consignee_company_id"] = consigneeCID.String()
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func deriveVesselParties(cargoRows []map[string]any) []map[string]any {
	seen := map[string]bool{}
	var parties []map[string]any
	add := func(role, name string, companyID *string, tier, provenance string, conf float64, lei, sanctions *string, cargoID, bolID string) {
		key := role + "|" + strings.ToLower(strings.TrimSpace(name))
		if name == "" || seen[key] {
			return
		}
		seen[key] = true
		p := map[string]any{
			"role": role, "name": name, "bol_tier": tier, "data_provenance": provenance,
			"confidence": conf, "cargo_record_id": cargoID,
		}
		if companyID != nil {
			p["company_id"] = *companyID
		}
		if lei != nil {
			p["lei"] = *lei
		}
		if sanctions != nil {
			p["sanctions_status"] = *sanctions
		}
		if bolID != "" {
			p["synthetic_bol_id"] = bolID
		}
		parties = append(parties, p)
	}

	for _, row := range cargoRows {
		cargoID, _ := row["id"].(string)
		bolID, _ := row["synthetic_bol_id"].(string)
		tier, _ := row["bol_tier"].(string)
		prov, _ := row["data_provenance"].(string)
		conf, _ := row["confidence"].(float64)
		if shipper, ok := row["shipper_name"].(string); ok {
			var cid *string
			if v, ok := row["shipper_company_id"].(string); ok && v != "" {
				cid = &v
			}
			var lei, sanctions *string
			if v, ok := row["shipper_lei"].(*string); ok {
				lei = v
			} else if v, ok := row["shipper_lei"].(string); ok {
				lei = &v
			}
			if v, ok := row["shipper_sanctions_status"].(*string); ok {
				sanctions = v
			} else if v, ok := row["shipper_sanctions_status"].(string); ok {
				sanctions = &v
			}
			add("shipper", shipper, cid, tier, prov, conf, lei, sanctions, cargoID, bolID)
		}
		if consignee, ok := row["consignee_name"].(string); ok {
			var cid *string
			if v, ok := row["consignee_company_id"].(string); ok && v != "" {
				cid = &v
			}
			var lei, sanctions *string
			if v, ok := row["consignee_lei"].(*string); ok {
				lei = v
			} else if v, ok := row["consignee_lei"].(string); ok {
				lei = &v
			}
			if v, ok := row["consignee_sanctions_status"].(*string); ok {
				sanctions = v
			} else if v, ok := row["consignee_sanctions_status"].(string); ok {
				sanctions = &v
			}
			add("consignee", consignee, cid, tier, prov, conf, lei, sanctions, cargoID, bolID)
		}
	}
	return parties
}

func parseEvidenceList(evidence []byte) []any {
	var ev []any
	_ = json.Unmarshal(evidence, &ev)
	return ev
}

func parseMetadataMap(metadata []byte) map[string]any {
	var meta map[string]any
	_ = json.Unmarshal(metadata, &meta)
	return meta
}

func extractSourceLinks(evidence, metadata []byte) []map[string]string {
	var links []map[string]string
	seen := map[string]bool{}
	add := func(name, url string) {
		url = strings.TrimSpace(url)
		if url == "" || seen[url] {
			return
		}
		seen[url] = true
		if name == "" {
			name = url
		}
		links = append(links, map[string]string{"name": name, "url": url})
	}

	text := string(evidence) + string(metadata)
	for _, u := range extractURLs(text) {
		add("source", u)
	}

	var ev []any
	if json.Unmarshal(evidence, &ev) == nil {
		for _, item := range ev {
			switch v := item.(type) {
			case string:
				for _, u := range extractURLs(v) {
					add("evidence", u)
				}
			case map[string]any:
				if u, ok := v["url"].(string); ok {
					n, _ := v["name"].(string)
					add(n, u)
				}
			}
		}
	}
	return links
}

func extractURLs(text string) []string {
	var out []string
	for _, part := range strings.Fields(text) {
		part = strings.Trim(part, `",[]{}`)
		if strings.HasPrefix(part, "http://") || strings.HasPrefix(part, "https://") {
			out = append(out, part)
		}
	}
	return out
}
