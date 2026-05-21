package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mining-map/oil-live-intel/internal/services/supplier"
)

type companyFilters struct {
	Q, Type, Country, SupplierStatus, Role string
	MinConfidence                          float64
	MinEvents                              int
}

func (s *Server) listTerminals(r *http.Request, bbox [4]float64, bboxOK bool, limit int) ([]map[string]any, error) {
	q := `
		SELECT id, name, terminal_type, operator_name, owner_name, country, port, city,
			products, source, confidence,
			ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon, metadata
		FROM oil_terminals WHERE geom IS NOT NULL`
	args := []any{}
	if bboxOK {
		q += ` AND geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`
		args = append(args, bbox[0], bbox[1], bbox[2], bbox[3])
	}
	q += fmt.Sprintf(` ORDER BY name LIMIT %d`, limit)
	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTerminalRows(rows)
}

func (s *Server) getTerminal(r *http.Request, id string) (map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT id, name, terminal_type, operator_name, owner_name, country, port, city,
			products, source, confidence,
			ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon, metadata
		FROM oil_terminals WHERE id::text = $1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := scanTerminalRows(rows)
	if err != nil || len(items) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return items[0], nil
}

func scanTerminalRows(rows pgx.Rows) ([]map[string]any, error) {
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, source string
		var ttype, op, owner, country, port, city *string
		var products []string
		var conf, lat, lon float64
		var meta []byte
		if err := rows.Scan(&id, &name, &ttype, &op, &owner, &country, &port, &city, &products, &source, &conf, &lat, &lon, &meta); err != nil {
			return nil, err
		}
		var metaMap map[string]any
		_ = json.Unmarshal(meta, &metaMap)
		out = append(out, map[string]any{
			"id": id.String(), "name": name, "terminal_type": ttype,
			"operator_name": op, "owner_name": owner, "country": country,
			"port": port, "city": city, "products": products, "source": source,
			"confidence": conf, "lat": lat, "lng": lon, "metadata": metaMap,
		})
	}
	return out, rows.Err()
}

func (s *Server) listLiveVessels(r *http.Request, bbox [4]float64, bboxOK bool, limit int) ([]map[string]any, error) {
	q := `
		SELECT DISTINCT ON (p.mmsi) p.mmsi, p.ts, p.lat, p.lon, p.speed, p.course, p.draft_m, p.destination,
			v.name, v.tanker_class, v.crude_capable, v.product_tanker
		FROM oil_ais_positions p
		LEFT JOIN oil_vessels v ON v.mmsi = p.mmsi
		WHERE p.ts > now() - interval '24 hours'`
	args := []any{}
	if bboxOK {
		q += ` AND p.geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`
		args = append(args, bbox[0], bbox[1], bbox[2], bbox[3])
	}
	q += fmt.Sprintf(` ORDER BY p.mmsi, p.ts DESC LIMIT %d`, limit)
	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var mmsi int64
		var ts time.Time
		var lat, lon float64
		var speed, course, draft *float64
		var dest, name, tclass *string
		var crude, product *bool
		if err := rows.Scan(&mmsi, &ts, &lat, &lon, &speed, &course, &draft, &dest, &name, &tclass, &crude, &product); err != nil {
			return nil, err
		}
		item := map[string]any{
			"mmsi": mmsi, "ts": ts, "lat": lat, "lng": lon,
			"destination": dest, "name": name, "tanker_class": tclass,
			"crude_capable": crude, "product_tanker": product,
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
		out = append(out, item)
	}
	return out, nil
}

func (s *Server) listRecentPortCalls(r *http.Request, limit int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, t.name AS terminal_name,
			pc.arrival_ts, pc.departure_ts, pc.duration_hours, pc.event_type,
			pc.product_family_inferred, pc.estimated_volume_barrels, pc.confidence, pc.status, pc.evidence,
			pc.metadata
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		ORDER BY COALESCE(pc.departure_ts, pc.arrival_ts) DESC NULLS LAST
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPortCalls(rows)
}

func (s *Server) getPortCall(r *http.Request, id string) (map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, t.name,
			pc.arrival_ts, pc.departure_ts, pc.duration_hours, pc.draft_in, pc.draft_out, pc.draft_delta,
			pc.event_type, pc.product_family_inferred, pc.estimated_volume_barrels, pc.confidence,
			pc.status, pc.evidence, pc.metadata, t.operator_name, t.country
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		WHERE pc.id::text = $1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, fmt.Errorf("not found")
	}
	var pid, tid uuid.UUID
	var mmsi int64
	var vessel, tname, event, family, status, op, country *string
	var arrival, departure *time.Time
	var dur, din, dout, ddelta, vol, conf *float64
	var evidence, metadata []byte
	if err := rows.Scan(&pid, &mmsi, &vessel, &tid, &tname, &arrival, &departure, &dur, &din, &dout, &ddelta,
		&event, &family, &vol, &conf, &status, &evidence, &metadata, &op, &country); err != nil {
		return nil, err
	}
	var ev []any
	var metaMap map[string]any
	_ = json.Unmarshal(evidence, &ev)
	_ = json.Unmarshal(metadata, &metaMap)
	return map[string]any{
		"id": pid.String(), "mmsi": mmsi, "vessel_name": vessel, "terminal_id": tid.String(),
		"terminal_name": tname, "operator_name": op, "country": country,
		"arrival_ts": arrival, "departure_ts": departure, "duration_hours": dur,
		"draft_in": din, "draft_out": dout, "draft_delta": ddelta,
		"event_type": event, "product_family_inferred": family,
		"estimated_volume_barrels": vol, "confidence": conf, "status": status,
		"evidence": ev, "metadata": metaMap,
		"data_provenance": inferPortCallProvenance(evidence, metadata),
		"disclaimer": "Inferred from public/free data. Not a confirmed private transaction.",
	}, nil
}

func scanPortCalls(rows pgx.Rows) ([]map[string]any, error) {
	var out []map[string]any
	for rows.Next() {
		var pid, tid uuid.UUID
		var mmsi int64
		var vessel, tname, event, family, status *string
		var arrival, departure *time.Time
		var dur, vol, conf *float64
		var evidence, metadata []byte
		if err := rows.Scan(&pid, &mmsi, &vessel, &tid, &tname, &arrival, &departure, &dur, &event, &family, &vol, &conf, &status, &evidence, &metadata); err != nil {
			return nil, err
		}
		var ev []any
		var metaMap map[string]any
		_ = json.Unmarshal(evidence, &ev)
		_ = json.Unmarshal(metadata, &metaMap)
		out = append(out, map[string]any{
			"id": pid.String(), "mmsi": mmsi, "vessel_name": vessel,
			"terminal_id": tid.String(), "terminal_name": tname,
			"arrival_ts": arrival, "departure_ts": departure, "duration_hours": dur,
			"event_type": event, "product_family_inferred": family,
			"estimated_volume_barrels": vol, "confidence": conf, "status": status,
			"evidence": ev, "metadata": metaMap,
			"data_provenance": inferPortCallProvenance(evidence, metadata),
		})
	}
	return out, rows.Err()
}

func (s *Server) listIntelligence(r *http.Request, limit int) ([]map[string]any, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT c.id, c.title, c.summary, c.event_type, c.product_family_inferred,
			c.possible_seller, c.possible_buyer, c.confidence, c.severity, c.evidence, c.created_at,
			t.name AS terminal_name, co.name AS company_name
		FROM oil_intelligence_cards c
		LEFT JOIN oil_terminals t ON t.id = c.terminal_id
		LEFT JOIN oil_companies co ON co.id = c.company_id
		ORDER BY c.created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var title, summary, event, family, seller, buyer, severity, tname, cname *string
		var conf float64
		var evidence []byte
		var created time.Time
		if err := rows.Scan(&id, &title, &summary, &event, &family, &seller, &buyer, &conf, &severity, &evidence, &created, &tname, &cname); err != nil {
			return nil, err
		}
		var ev []any
		_ = json.Unmarshal(evidence, &ev)
		out = append(out, map[string]any{
			"id": id.String(), "title": title, "summary": summary, "event_type": event,
			"product_family_inferred": family, "possible_seller": seller, "possible_buyer": buyer,
			"confidence": conf, "severity": severity, "evidence": ev, "created_at": created,
			"terminal_name": tname, "company_name": cname,
			"disclaimer": "Inferred from public/free data. Not a confirmed private transaction.",
		})
	}
	return out, rows.Err()
}

func (s *Server) getIntelligence(r *http.Request, id string) (map[string]any, error) {
	items, err := s.listIntelligence(r, 500)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if it["id"] == id {
			return it, nil
		}
	}
	return nil, fmt.Errorf("not found")
}

func (s *Server) companyListWhere(f companyFilters) (where string, args []any) {
	where = ` WHERE c.confidence >= $1`
	args = []any{f.MinConfidence}
	n := 2
	if f.Q != "" {
		where += fmt.Sprintf(` AND (c.name ILIKE $%d OR c.normalized_name ILIKE $%d)`, n, n)
		args = append(args, "%"+f.Q+"%")
		n++
	}
	if f.Type != "" {
		where += fmt.Sprintf(` AND c.company_type = $%d`, n)
		args = append(args, f.Type)
		n++
	}
	if f.Country != "" {
		where += fmt.Sprintf(` AND c.country ILIKE $%d`, n)
		args = append(args, "%"+f.Country+"%")
		n++
	}
	if f.SupplierStatus != "" {
		where += fmt.Sprintf(` AND c.supplier_status = $%d`, n)
		args = append(args, f.SupplierStatus)
		n++
	}
	if f.Role != "" {
		where += fmt.Sprintf(` AND (
			c.company_type = $%d OR
			COALESCE(c.metadata->'roles', '[]'::jsonb) ? $%d OR
			EXISTS (
				SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.metadata->'roles', '[]'::jsonb)) r
				WHERE r = $%d
			)
		)`, n, n, n)
		args = append(args, f.Role)
		n++
	}
	if f.MinEvents > 0 {
		where += fmt.Sprintf(` AND (
			SELECT COUNT(*)::int FROM oil_commercial_events e WHERE e.company_id = c.id
		) >= $%d`, n)
		args = append(args, f.MinEvents)
		n++
	}
	return where, args
}

func companySourcesFromMeta(sourceCol string, metaMap map[string]any) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	add(sourceCol)
	if raw, ok := metaMap["sources"].([]any); ok {
		for _, item := range raw {
			if m, ok := item.(map[string]any); ok {
				if name, ok := m["name"].(string); ok {
					add(name)
				}
			}
		}
	}
	return out
}

func (s *Server) countCompanies(r *http.Request, f companyFilters) (int, error) {
	where, args := s.companyListWhere(f)
	var total int
	err := s.Pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM oil_companies c`+where, args...).Scan(&total)
	return total, err
}

func (s *Server) listCompanies(r *http.Request, f companyFilters, limit, offset int) ([]map[string]any, error) {
	where, args := s.companyListWhere(f)
	q := `SELECT c.id, c.name, c.company_type, c.country, c.website, c.confidence, c.supplier_status, c.supplier_id, c.source, c.metadata,
			COALESCE((SELECT COUNT(*)::int FROM meridian_cargo_records m WHERE m.shipper_company_id = c.id OR m.consignee_company_id = c.id), 0) AS mcr_count,
			COALESCE((SELECT COUNT(*)::int FROM oil_commercial_events e WHERE e.company_id = c.id), 0) AS event_count,
			COALESCE((SELECT COUNT(*)::int FROM oil_company_contacts cc WHERE cc.company_id = c.id), 0) AS contact_count,
			COALESCE(c.metadata->'roles', '[]'::jsonb) AS roles
		FROM oil_companies c` + where
	n := len(args) + 1
	q += fmt.Sprintf(` ORDER BY c.confidence DESC, c.name LIMIT $%d OFFSET $%d`, n, n+1)
	args = append(args, limit, offset)
	rows, err := s.Pool.Query(r.Context(), q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var name, ctype, country, status, sourceCol string
		var website, supplierID *string
		var conf float64
		var meta []byte
		var mcrCount, eventCount, contactCount int
		var roles []byte
		if err := rows.Scan(&id, &name, &ctype, &country, &website, &conf, &status, &supplierID, &sourceCol, &meta,
			&mcrCount, &eventCount, &contactCount, &roles); err != nil {
			return nil, err
		}
		var metaMap map[string]any
		var rolesList []any
		_ = json.Unmarshal(meta, &metaMap)
		_ = json.Unmarshal(roles, &rolesList)
		if rolesList == nil {
			rolesList = []any{ctype}
		}
		out = append(out, map[string]any{
			"id": id.String(), "name": name, "company_type": ctype, "country": country,
			"website": website, "confidence": conf, "supplier_status": status,
			"supplier_id": supplierID, "metadata": metaMap, "source": sourceCol,
			"mcr_count": mcrCount, "event_count": eventCount, "contact_count": contactCount,
			"roles": rolesList, "sources": companySourcesFromMeta(sourceCol, metaMap),
		})
	}
	return out, rows.Err()
}

func (s *Server) getCompany(r *http.Request, id string) (map[string]any, error) {
	items, err := s.listCompanies(r, companyFilters{}, 1000, 0)
	if err != nil {
		return nil, err
	}
	for _, it := range items {
		if it["id"] == id {
			return it, nil
		}
	}
	return nil, fmt.Errorf("not found")
}

func (s *Server) getCompanyRow(r *http.Request, id uuid.UUID) (supplier.Company, error) {
	var c supplier.Company
	var meta []byte
	var website *string
	err := s.Pool.QueryRow(r.Context(), `
		SELECT id, name, company_type, country, website, confidence, metadata
		FROM oil_companies WHERE id=$1
	`, id).Scan(&c.ID, &c.Name, &c.CompanyType, &c.Country, &website, &c.Confidence, &meta)
	if err != nil {
		return c, err
	}
	if website != nil {
		c.Website = *website
	}
	_ = json.Unmarshal(meta, &c.Metadata)
	return c, nil
}

func (s *Server) terminalNamesForCompany(r *http.Request, name, country string) ([]string, error) {
	rows, err := s.Pool.Query(r.Context(), `
		SELECT name FROM oil_terminals
		WHERE operator_name ILIKE '%' || $1 || '%' OR owner_name ILIKE '%' || $1 || '%'
		LIMIT 10
	`, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		names = append(names, n)
	}
	_ = country
	return names, rows.Err()
}
