package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mining-map/oil-live-intel/internal/services/dealpack"
	"github.com/mining-map/oil-live-intel/internal/services/syntheticbol"
)

func (s *Server) ListCargoRecords(w http.ResponseWriter, r *http.Request) {
	commodity := r.URL.Query().Get("commodity")
	country := r.URL.Query().Get("country")
	mmsi := r.URL.Query().Get("mmsi")
	minConf := queryFloat(r, "min_confidence", 0.0)
	excludeSeed := queryBool(r, "exclude_seed", false)
	limit := queryInt(r, "limit", 50)

	q := `
		SELECT m.id, m.synthetic_bol_id, m.recipe, m.commodity_family, m.confidence, m.triangulation_score,
			m.bol_tier, m.shipper_name, m.consignee_name, m.vessel_name, m.mmsi, m.load_port_name, m.load_country,
			m.discharge_hint, m.volume_best_estimate, m.volume_unit, m.event_date,
			m.corridor_load_lat, m.corridor_load_lng, m.corridor_discharge_lat, m.corridor_discharge_lng,
			pc.evidence, pc.metadata
		FROM meridian_cargo_records m
		LEFT JOIN oil_port_calls pc ON pc.id = m.port_call_id
		WHERE m.confidence >= $1
	`
	args := []any{minConf}
	n := 2
	if excludeSeed {
		q += `
			AND NOT (
				COALESCE(pc.evidence::text, '') LIKE '%seed_port_calls%'
				OR COALESCE(pc.metadata::text, '') LIKE '%seed_port_calls%'
			)
		`
	}
	if commodity != "" {
		q += fmt.Sprintf(` AND m.commodity_family = $%d`, n)
		args = append(args, commodity)
		n++
	}
	if country != "" {
		q += fmt.Sprintf(` AND (m.load_country ILIKE $%d OR m.discharge_country ILIKE $%d)`, n, n)
		args = append(args, "%"+country+"%")
		n++
	}
	if mmsi != "" {
		q += fmt.Sprintf(` AND m.mmsi::text = $%d`, n)
		args = append(args, mmsi)
		n++
	}
	q += fmt.Sprintf(` ORDER BY m.triangulation_score DESC NULLS LAST, m.confidence DESC, m.event_date DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)

	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var bolID, recipe, family, tier string
		var shipper, consignee, vessel, loadPort, loadCountry, discharge *string
		var mmsiVal *int64
		var conf float64
		var tri int
		var vol *float64
		var volUnit *string
		var eventDate *time.Time
		var loadLat, loadLng, discLat, discLng *float64
		var pcEvidence, pcMetadata []byte
		if err := rows.Scan(&id, &bolID, &recipe, &family, &conf, &tri, &tier,
			&shipper, &consignee, &vessel, &mmsiVal, &loadPort, &loadCountry, &discharge, &vol, &volUnit, &eventDate,
			&loadLat, &loadLng, &discLat, &discLng, &pcEvidence, &pcMetadata); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		provenance := inferCargoProvenance(tier)
		if portProv := inferPortCallProvenance(pcEvidence, pcMetadata); portProv != "unknown" {
			provenance = portProv
		}
		items = append(items, map[string]any{
			"id": id.String(), "synthetic_bol_id": bolID, "recipe": recipe,
			"commodity_family": family, "confidence": conf, "triangulation_score": tri,
			"bol_tier": tier, "data_provenance": provenance,
			"shipper_name": shipper, "consignee_name": consignee, "vessel_name": vessel,
			"mmsi": mmsiVal, "load_port_name": loadPort, "load_country": loadCountry,
			"discharge_hint": discharge, "volume_best_estimate": vol, "volume_unit": volUnit,
			"event_date": formatTimePtr(eventDate),
			"corridor_load_lat": loadLat, "corridor_load_lng": loadLng,
			"corridor_discharge_lat": discLat, "corridor_discharge_lng": discLng,
			"disclaimer": "Synthetic cargo record — inferred from public sources, not a legal BOL.",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"cargo_records": items, "count": len(items)})
}

func (s *Server) GetCargoRecord(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, synthetic_bol_id, fingerprint, recipe, commodity_family, confidence, triangulation_score,
			bol_tier, shipper_name, consignee_name, shipper_company_id, consignee_company_id,
			vessel_name, mmsi, imo, load_terminal_id, load_port_name, load_country,
			discharge_hint, discharge_country, commodity_description,
			volume_low, volume_high, volume_best_estimate, volume_method, volume_unit,
			event_date, port_call_id, evidence_chain, sources, contact_ids, metadata
		FROM meridian_cargo_records WHERE id::text = $1 OR synthetic_bol_id = $1
		LIMIT 1
	`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	if !rows.Next() {
		writeErr(w, http.StatusNotFound, "cargo record not found")
		return
	}
	item, err := scanCargoRecord(rows)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	item["disclaimer"] = "Synthetic cargo record — inferred from public sources, not a legal Bill of Lading."
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) ListCommercialEvents(w http.ResponseWriter, r *http.Request) {
	eventType := r.URL.Query().Get("event_type")
	country := r.URL.Query().Get("country")
	limit := queryInt(r, "limit", 50)
	q := `SELECT id, event_type, title, summary, country, partner_country, commodity_family,
		confidence, record_tier, occurred_at FROM oil_commercial_events WHERE 1=1`
	args := []any{}
	n := 1
	if eventType != "" {
		q += fmt.Sprintf(` AND event_type = $%d`, n)
		args = append(args, eventType)
		n++
	}
	if country != "" {
		q += fmt.Sprintf(` AND country ILIKE $%d`, n)
		args = append(args, "%"+country+"%")
		n++
	}
	q += fmt.Sprintf(` ORDER BY occurred_at DESC NULLS LAST LIMIT $%d`, n)
	args = append(args, limit)
	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	var events []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var etype, title string
		var summary, countryVal, partner, family, tier *string
		var conf float64
		var occurred *string
		_ = rows.Scan(&id, &etype, &title, &summary, &countryVal, &partner, &family, &conf, &tier, &occurred)
		events = append(events, map[string]any{
			"id": id.String(), "event_type": etype, "title": title, "summary": summary,
			"country": countryVal, "partner_country": partner, "commodity_family": family,
			"confidence": conf, "record_tier": tier, "occurred_at": occurred,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) TriggerSyntheticBolRebuild(w http.ResponseWriter, r *http.Request) {
	if s.Config.InternalBroadcastKey == "" || r.Header.Get("X-Oil-Intel-Internal") != s.Config.InternalBroadcastKey {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	res, err := syntheticbol.RunRebuild(r.Context(), s.Pool, s.Log)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) OpportunityDealPack(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	oid, err := uuid.Parse(id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid opportunity id")
		return
	}
	pack, err := dealpack.Build(r.Context(), s.Pool, oid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pack)
}

func scanCargoRecord(rows interface {
	Next() bool
	Scan(dest ...any) error
}) (map[string]any, error) {
	var id uuid.UUID
	var bolID, fingerprint, recipe, family, tier string
	var shipper, consignee, vessel, loadPort, loadCountry, discharge, dischargeCountry, desc, volMethod, volUnit *string
	var shipperCID, consigneeCID, loadTID, pcID *uuid.UUID
	var mmsi *int64
	var imo *string
	var conf float64
	var tri int
	var volLo, volHi, volBest *float64
	var eventDate *time.Time
	var evidence, sources, meta []byte
	var contactIDs []uuid.UUID
	if err := rows.Scan(&id, &bolID, &fingerprint, &recipe, &family, &conf, &tri, &tier,
		&shipper, &consignee, &shipperCID, &consigneeCID, &vessel, &mmsi, &imo, &loadTID,
		&loadPort, &loadCountry, &discharge, &dischargeCountry, &desc,
		&volLo, &volHi, &volBest, &volMethod, &volUnit, &eventDate, &pcID, &evidence, &sources, &contactIDs, &meta); err != nil {
		return nil, err
	}
	var evChain, srcList, metaMap any
	_ = json.Unmarshal(evidence, &evChain)
	_ = json.Unmarshal(sources, &srcList)
	_ = json.Unmarshal(meta, &metaMap)
	contacts := make([]string, len(contactIDs))
	for i, cid := range contactIDs {
		contacts[i] = cid.String()
	}
	out := map[string]any{
		"id": id.String(), "synthetic_bol_id": bolID, "fingerprint": fingerprint,
		"recipe": recipe, "commodity_family": family, "confidence": conf,
		"triangulation_score": tri, "bol_tier": tier, "data_provenance": inferCargoProvenance(tier),
		"shipper_name": shipper, "consignee_name": consignee,
		"vessel_name": vessel, "mmsi": mmsi, "imo": imo,
		"load_port_name": loadPort, "load_country": loadCountry,
		"discharge_hint": discharge, "discharge_country": dischargeCountry,
		"commodity_description": desc,
		"volume_low": volLo, "volume_high": volHi, "volume_best_estimate": volBest,
		"volume_method": volMethod, "volume_unit": volUnit, "event_date": formatTimePtr(eventDate),
		"evidence_chain": evChain, "sources": srcList, "metadata": metaMap, "contact_ids": contacts,
	}
	if shipperCID != nil {
		out["shipper_company_id"] = shipperCID.String()
	}
	if consigneeCID != nil {
		out["consignee_company_id"] = consigneeCID.String()
	}
	if loadTID != nil {
		out["load_terminal_id"] = loadTID.String()
	}
	if pcID != nil {
		out["port_call_id"] = pcID.String()
	}
	return out, nil
}
