package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/intelligence"
)

var legacyIntelligenceTables = []string{
	"oil_port_calls",
	"oil_sts_events",
	"eia_historic_imports",
	"oil_commercial_events",
	"broker_deal_packs",
	"oil_company_contacts",
	"oil_intelligence_cards",
	"entity_relationships",
}

func filterIntelligenceTables(requested []string) []string {
	if len(requested) == 0 {
		return nil
	}
	want := map[string]bool{}
	for _, t := range requested {
		want[strings.TrimSpace(t)] = true
	}
	var out []string
	for _, t := range legacyIntelligenceTables {
		if want[t] {
			out = append(out, t)
		}
	}
	return out
}

func (s *Service) processLegacyIntelligenceImport(ctx context.Context, jobID uuid.UUID, tables []string, opts legacyImportOpts, started time.Time) error {
	if s.cfg.LegacyDBURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL not configured")
	}
	legacy, err := s.poolFromLegacy(ctx)
	if err != nil {
		return err
	}
	defer legacy.Close()

	sourceID := uuid.Nil
	if !opts.DryRun {
		sourceID, _ = s.ensureSource(ctx, "legacy_mining_db")
	}

	counts := map[string]int{}
	var lastErr error
	for _, table := range tables {
		n, err := s.importLegacyIntelligenceTable(ctx, legacy, sourceID, table, opts.MaxRows, opts.DryRun)
		counts[table] = n
		if err != nil && lastErr == nil {
			lastErr = err
		}
	}

	report := buildLegacyImportReport(map[string]any{
		"engine":        "go_intelligence",
		"imported":      sumCounts(counts),
		"legacy_counts": counts,
		"tables":        tables,
		"dry_run":       opts.DryRun,
	}, started)
	status := "completed"
	errMsg := ""
	if lastErr != nil {
		errMsg = lastErr.Error()
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	return err
}

func (s *Service) poolFromLegacy(ctx context.Context) (*pgxpool.Pool, error) {
	return database.ConnectURL(ctx, s.cfg.LegacyDBURL)
}

func sumCounts(m map[string]int) int {
	n := 0
	for _, v := range m {
		n += v
	}
	return n
}

func (s *Service) importLegacyIntelligenceTable(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, table string, maxRows int, dryRun bool) (int, error) {
	switch table {
	case "oil_port_calls":
		return s.importLegacyPortCalls(ctx, legacy, sourceID, maxRows, dryRun)
	case "oil_sts_events":
		if err := s.importLegacySTSZones(ctx, legacy, dryRun); err != nil {
			return 0, err
		}
		return s.importLegacySTSEvents(ctx, legacy, maxRows, dryRun)
	case "eia_historic_imports":
		return s.importLegacyEIAHistoric(ctx, legacy, sourceID, maxRows, dryRun)
	case "oil_commercial_events":
		return s.importLegacyCommercialEvents(ctx, legacy, maxRows, dryRun)
	case "broker_deal_packs":
		return s.importLegacyBrokerDealPacks(ctx, legacy, maxRows, dryRun)
	case "oil_company_contacts":
		return s.importLegacyCompanyContacts(ctx, legacy, sourceID, maxRows, dryRun)
	case "oil_intelligence_cards":
		return s.importLegacyIntelligenceCards(ctx, legacy, sourceID, maxRows, dryRun)
	case "entity_relationships":
		return s.importLegacyEntityRelationships(ctx, legacy, sourceID, maxRows, dryRun)
	default:
		return 0, fmt.Errorf("unknown intelligence table %q", table)
	}
}

func (s *Service) vesselIDByMMSI(ctx context.Context, mmsi string) uuid.UUID {
	if mmsi == "" {
		return uuid.Nil
	}
	var id uuid.UUID
	_ = s.pool.QueryRow(ctx, `SELECT id FROM vessels WHERE mmsi = $1 LIMIT 1`, mmsi).Scan(&id)
	return id
}

func (s *Service) companyIDByLegacyOilCompany(ctx context.Context, legacy *pgxpool.Pool, legacyCompanyID uuid.UUID) uuid.UUID {
	if legacyCompanyID == uuid.Nil {
		return uuid.Nil
	}
	var name string
	if err := legacy.QueryRow(ctx, `SELECT name FROM oil_companies WHERE id = $1`, legacyCompanyID).Scan(&name); err != nil {
		return uuid.Nil
	}
	name = normalizeName(name)
	if name == "" {
		return uuid.Nil
	}
	var id uuid.UUID
	_ = s.pool.QueryRow(ctx, `SELECT id FROM companies WHERE normalized_name = lower($1) LIMIT 1`, name).Scan(&id)
	return id
}

func (s *Service) importLegacyPortCalls(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT pc.id, pc.mmsi, pc.vessel_name, pc.terminal_id, pc.arrival_ts, pc.departure_ts,
		       pc.duration_hours, pc.event_type, pc.product_family_inferred, pc.confidence, pc.status,
		       COALESCE(t.name, ''), COALESCE(t.country, '')
		FROM oil_port_calls pc
		LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
		ORDER BY pc.id OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyID := fmt.Sprint(row["id"])
		mmsi := legacyMMSIStr(row["mmsi"])
		vesselID := s.vesselIDByMMSI(ctx, mmsi)
		if vesselID == uuid.Nil {
			return nil
		}
		terminalName := fmt.Sprint(row["terminal_name"])
		terminalCountry := fmt.Sprint(row["terminal_country"])
		eventType := fmt.Sprint(row["event_type"])
		family := fmt.Sprint(row["product_family_inferred"])
		conf, _ := toFloat(row["confidence"])
		if conf <= 1 {
			conf *= 100
		}
		arrival, _ := row["arrival_ts"].(time.Time)
		departure, _ := row["departure_ts"].(time.Time)

		loadPort, loadCountry, dischargePort, dischargeCountry := portCallVoyagePorts(eventType, terminalName, terminalCountry)

		payload, _ := json.Marshal(map[string]any{
			"legacy_port_call_id": legacyID,
			"terminal_name":       terminalName,
			"terminal_country":    terminalCountry,
			"event_type":          eventType,
			"commodity_family":    family,
			"status":              row["status"],
			"source":              "legacy_import",
		})
		meta, _ := json.Marshal(map[string]any{
			"legacy_port_call_id": legacyID,
			"event_type":          eventType,
			"source":              "legacy_import",
		})

		tier := "inferred"
		_, err := s.pool.Exec(ctx, `
			INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload, observed_at)
			VALUES ('vessel', $1, 'port_call', $2, $3, $4, COALESCE($5, now()))
			ON CONFLICT ((payload->>'legacy_port_call_id')) WHERE signal_type = 'port_call' AND payload->>'legacy_port_call_id' IS NOT NULL
			DO NOTHING
		`, vesselID, tier, conf, payload, nullableTime(arrival))
		if err != nil {
			return err
		}

		_, err = s.pool.Exec(ctx, `
			INSERT INTO voyages (
				vessel_id, mmsi, load_port_name, load_country,
				discharge_port_name, discharge_country, commodity_family,
				started_at, ended_at, confidence_score, tier, metadata
			) VALUES (
				$1, $2, NULLIF($3,''), NULLIF($4,''),
				NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
				$8, $9, $10, 'inferred', $11
			)
			ON CONFLICT ((metadata->>'legacy_port_call_id')) WHERE metadata->>'legacy_port_call_id' IS NOT NULL
			DO NOTHING
		`, vesselID, mmsi, loadPort, loadCountry, dischargePort, dischargeCountry, family,
			nullableTime(arrival), nullableTime(departure), conf, meta)
		if err != nil {
			return err
		}

		if sourceID != uuid.Nil {
			claim := fmt.Sprintf("%s (%s) %s", terminalName, terminalCountry, eventType)
			_, _ = s.pool.Exec(ctx, `
				INSERT INTO evidence (source_id, entity_type, entity_id, claim_type, claim_value, confidence_score, tier)
				VALUES ($1, 'vessel', $2, $3, $4, $5, 'inferred')
				ON CONFLICT (source_id, entity_type, entity_id, claim_type) DO UPDATE SET
					claim_value = EXCLUDED.claim_value,
					confidence_score = GREATEST(evidence.confidence_score, EXCLUDED.confidence_score)
			`, sourceID, vesselID, "port_call:"+legacyID, claim, conf)
		}
		return nil
	})
}

func portCallVoyagePorts(eventType, terminalName, terminalCountry string) (loadPort, loadCountry, dischargePort, dischargeCountry string) {
	switch eventType {
	case "possible_loading", "likely_load":
		return terminalName, terminalCountry, "", ""
	case "possible_unloading", "likely_discharge":
		return "", "", terminalName, terminalCountry
	default:
		return terminalName, terminalCountry, "", ""
	}
}

func (s *Service) importLegacySTSZones(ctx context.Context, legacy *pgxpool.Pool, dryRun bool) error {
	var n int64
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM sts_zones`).Scan(&n)
	if n > 0 || dryRun {
		return nil
	}
	rows, err := legacy.Query(ctx, `
		SELECT id, name, zone_type, ST_AsEWKB(geom) AS geom_wkb, source, confidence, metadata
		FROM oil_sts_zones`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var legacyID uuid.UUID
		var name, zoneType, source string
		var geomWKB []byte
		var confidence float64
		var metadata []byte
		if rows.Scan(&legacyID, &name, &zoneType, &geomWKB, &source, &confidence, &metadata) != nil {
			continue
		}
		_, err = s.pool.Exec(ctx, `
			INSERT INTO sts_zones (legacy_zone_id, name, zone_type, geom, source, confidence, metadata)
			VALUES ($1, $2, $3, ST_GeomFromEWKB($4)::geography, $5, $6, COALESCE($7::jsonb, '{}'))
			ON CONFLICT (legacy_zone_id) DO NOTHING
		`, legacyID, name, zoneType, geomWKB, source, confidence, metadata)
		if err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *Service) importLegacySTSEvents(ctx context.Context, legacy *pgxpool.Pool, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT e.id, e.mmsi_a, e.mmsi_b, e.start_ts, e.end_ts, e.min_distance_m, e.avg_sog,
		       COALESCE(z.name, '') AS zone_name,
		       COALESCE(va.tanker_class, '') AS tanker_class_a,
		       COALESCE(vb.tanker_class, '') AS tanker_class_b,
		       COALESCE(va.name, '') AS name_a, COALESCE(vb.name, '') AS name_b
		FROM oil_sts_events e
		LEFT JOIN oil_sts_zones z ON z.id = e.zone_id
		LEFT JOIN oil_vessels va ON va.mmsi = e.mmsi_a
		LEFT JOIN oil_vessels vb ON vb.mmsi = e.mmsi_b
		ORDER BY e.start_ts OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyID := fmt.Sprint(row["id"])
		mmsiA := legacyMMSIStr(row["mmsi_a"])
		mmsiB := legacyMMSIStr(row["mmsi_b"])
		vesselID := s.vesselIDByMMSI(ctx, mmsiA)
		if vesselID == uuid.Nil {
			vesselID = s.vesselIDByMMSI(ctx, mmsiB)
		}
		if vesselID == uuid.Nil {
			return nil
		}
		startTS, _ := row["start_ts"].(time.Time)
		endTS, _ := row["end_ts"].(time.Time)
		minDist, _ := toFloat(row["min_distance_m"])
		avgSOG, _ := toFloat(row["avg_sog"])
		zoneName := fmt.Sprint(row["zone_name"])
		classA := fmt.Sprint(row["tanker_class_a"])
		classB := fmt.Sprint(row["tanker_class_b"])

		score := intelligence.ScoreSTS(intelligence.STSScoreInput{
			MinDistanceM:    minDist,
			DurationHours:   endTS.Sub(startTS).Hours(),
			AvgSOG:          avgSOG,
			BothTankers:     isTankerClass(classA) && isTankerClass(classB),
			InSTSZone:       zoneName != "" && zoneName != "<nil>",
			OutsideTerminal: true,
			ZoneName:        zoneName,
		})

		payload, _ := json.Marshal(map[string]any{
			"legacy_sts_id":      legacyID,
			"mmsi_a":             mmsiA,
			"mmsi_b":             mmsiB,
			"name_a":             row["name_a"],
			"name_b":             row["name_b"],
			"zone_name":          zoneName,
			"min_distance_m":     minDist,
			"duration_hours":     endTS.Sub(startTS).Hours(),
			"score":              score,
			"source":             "legacy_import",
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload, observed_at)
			VALUES ('vessel', $1, 'sts', $2, $3, $4, $5)
			ON CONFLICT ((payload->>'legacy_sts_id')) WHERE signal_type = 'sts' AND payload->>'legacy_sts_id' IS NOT NULL
			DO NOTHING
		`, vesselID, score.DataTier, score.Score, payload, startTS)
		return err
	})
}

func isTankerClass(class string) bool {
	switch class {
	case "crude", "product", "chemical", "lng", "lpg", "tanker":
		return true
	default:
		return false
	}
}

func (s *Service) importLegacyEIAHistoric(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT id, period_year, period_month, importer_name, origin_country, origin_name,
		       product, commodity_family, volume, volume_unit, value_usd,
		       port_code, port_city, port_state, source_file, raw
		FROM eia_historic_imports
		ORDER BY id OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyID := fmt.Sprint(row["id"])
		year, _ := toFloat(row["period_year"])
		month, _ := toFloat(row["period_month"])
		vol, _ := toFloat(row["volume"])
		valueUSD, _ := toFloat(row["value_usd"])
		price := vol
		if price == 0 {
			price = valueUSD
		}
		observed := eiaHistoricObserved(int(year), int(month))
		unit := fmt.Sprint(row["volume_unit"])
		if unit == "" || unit == "<nil>" {
			unit = "bbl"
		}
		location := strings.TrimSpace(fmt.Sprint(row["port_city"]))
		if location == "" || location == "<nil>" {
			location = fmt.Sprint(row["importer_name"])
		}
		raw, _ := json.Marshal(map[string]any{
			"legacy_eia_id":    legacyID,
			"importer_name":    row["importer_name"],
			"origin_country":   row["origin_country"],
			"origin_name":      row["origin_name"],
			"product":          row["product"],
			"commodity_family": row["commodity_family"],
			"port_code":        row["port_code"],
			"port_state":       row["port_state"],
			"source_file":      row["source_file"],
			"value_usd":        valueUSD,
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO prices (location_name, price, currency, unit, price_type, observed_at, source_id, confidence_score, raw_payload)
			VALUES ($1, $2, 'USD', $3, 'eia_historic_import', $4, NULLIF($5::uuid, '00000000-0000-0000-0000-000000000000'), 85, $6)
			ON CONFLICT ((raw_payload->>'legacy_eia_id')) WHERE raw_payload->>'legacy_eia_id' IS NOT NULL
			DO NOTHING
		`, location, price, unit, observed, sourceID, raw)
		return err
	})
}

func eiaHistoricObserved(year, month int) time.Time {
	if year <= 0 {
		return time.Now().UTC()
	}
	if month <= 0 || month > 12 {
		month = 1
	}
	return time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
}

func (s *Service) importLegacyCommercialEvents(ctx context.Context, legacy *pgxpool.Pool, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT id, event_type, fingerprint, title, summary, country, partner_country,
		       commodity_family, mmsi, company_id, volume_best_estimate, confidence,
		       record_tier, occurred_at
		FROM oil_commercial_events
		ORDER BY occurred_at DESC NULLS LAST, id OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		fingerprint := fmt.Sprint(row["fingerprint"])
		if fingerprint == "" {
			return nil
		}
		entityType := "company"
		var entityID uuid.UUID
		if mmsi := legacyMMSIStr(row["mmsi"]); mmsi != "" {
			entityID = s.vesselIDByMMSI(ctx, mmsi)
			if entityID != uuid.Nil {
				entityType = "vessel"
			}
		}
		if entityID == uuid.Nil {
			if cid := parseUUID(row["company_id"]); cid != uuid.Nil {
				entityID = s.companyIDByLegacyOilCompany(ctx, legacy, cid)
			}
		}
		if entityID == uuid.Nil {
			return nil
		}
		conf, _ := toFloat(row["confidence"])
		if conf <= 1 {
			conf *= 100
		}
		tier := fmt.Sprint(row["record_tier"])
		if tier == "" || tier == "<nil>" {
			tier = "inferred"
		}
		occurred, _ := row["occurred_at"].(time.Time)
		payload, _ := json.Marshal(map[string]any{
			"fingerprint":      fingerprint,
			"legacy_event_id":  fmt.Sprint(row["id"]),
			"event_type":       row["event_type"],
			"title":            row["title"],
			"summary":          row["summary"],
			"country":          row["country"],
			"partner_country":  row["partner_country"],
			"commodity_family": row["commodity_family"],
			"volume":           row["volume_best_estimate"],
			"source":           "legacy_import",
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO core_signals (entity_type, entity_id, signal_type, tier, confidence_score, payload, observed_at)
			VALUES ($1, $2, 'commercial_event', $3, $4, $5, COALESCE($6, now()))
			ON CONFLICT ((payload->>'fingerprint')) WHERE signal_type = 'commercial_event' AND payload->>'fingerprint' IS NOT NULL
			DO NOTHING
		`, entityType, entityID, tier, conf, payload, nullableTime(occurred))
		return err
	})
}

func (s *Service) importLegacyBrokerDealPacks(ctx context.Context, legacy *pgxpool.Pool, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT id, name, status, journal, transport, economics, map_lat, map_lng, created_at
		FROM broker_deal_packs
		ORDER BY created_at OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyID := fmt.Sprint(row["id"])
		name := fmt.Sprint(row["name"])
		status := fmt.Sprint(row["status"])
		if status == "" {
			status = "draft"
		}
		meta, _ := json.Marshal(map[string]any{
			"legacy_broker_pack_id": legacyID,
			"legacy_table":          "broker_deal_packs",
			"journal":               parseJSONAny(row["journal"]),
			"transport":             parseJSONAny(row["transport"]),
			"economics":             parseJSONAny(row["economics"]),
			"map_lat":               row["map_lat"],
			"map_lng":               row["map_lng"],
			"source":                "legacy_import",
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO deals (title, status, metadata, created_at)
			VALUES ($1, $2, $3, COALESCE($4, now()))
			ON CONFLICT ((metadata->>'legacy_broker_pack_id')) WHERE metadata->>'legacy_broker_pack_id' IS NOT NULL
			DO NOTHING
		`, name, status, meta, row["created_at"])
		return err
	})
}

func (s *Service) importLegacyCompanyContacts(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT cc.id, cc.company_id, cc.contact_type, cc.label, cc.value, cc.source_type, cc.notes
		FROM oil_company_contacts cc
		ORDER BY cc.id OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyContactID := fmt.Sprint(row["id"])
		companyID := parseUUID(row["company_id"])
		if companyID == uuid.Nil {
			return nil
		}
		madsanCompany := s.companyIDByLegacyOilCompany(ctx, legacy, companyID)
		if madsanCompany == uuid.Nil {
			return nil
		}
		contactType := strings.ToLower(fmt.Sprint(row["contact_type"]))
		value := strings.TrimSpace(fmt.Sprint(row["value"]))
		if value == "" || value == "<nil>" {
			return nil
		}
		var email, phone string
		switch {
		case strings.Contains(contactType, "email"):
			email = value
		case strings.Contains(contactType, "phone"), strings.Contains(contactType, "tel"):
			phone = value
		default:
			if strings.Contains(value, "@") {
				email = value
			} else {
				phone = value
			}
		}
		label := fmt.Sprint(row["label"])
		meta, _ := json.Marshal(map[string]any{
			"legacy_contact_id": legacyContactID,
			"contact_type":      contactType,
			"source_type":       row["source_type"],
			"notes":             row["notes"],
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO contacts (company_id, name, email, phone, role, source_id, confidence_score, verification_status, metadata)
			VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), $5, NULLIF($6::uuid, '00000000-0000-0000-0000-000000000000'), 70, 'official_register', $7)
			ON CONFLICT ((metadata->>'legacy_contact_id')) WHERE metadata->>'legacy_contact_id' IS NOT NULL
			DO NOTHING
		`, madsanCompany, label, email, phone, contactType, sourceID, meta)
		return err
	})
}

type legacyRowFn func(map[string]any) error

func (s *Service) batchLegacyImport(ctx context.Context, legacy *pgxpool.Pool, maxRows int, dryRun bool, query string, fn legacyRowFn) (int, error) {
	imported := 0
	offset := 0
	for {
		if maxRows > 0 && imported >= maxRows {
			break
		}
		limit := legacyBatchSize
		if maxRows > 0 && imported+limit > maxRows {
			limit = maxRows - imported
		}
		rows, err := legacy.Query(ctx, query, offset, limit)
		if err != nil {
			return imported, err
		}
		batch, err := pgx.CollectRows(rows, pgx.RowToMap)
		if err != nil {
			return imported, err
		}
		if len(batch) == 0 {
			break
		}
		for _, row := range batch {
			if dryRun {
				imported++
				continue
			}
			if err := fn(row); err != nil {
				continue
			}
			imported++
		}
		offset += len(batch)
		if len(batch) < limit {
			break
		}
	}
	return imported, nil
}

func legacyMMSIStr(v any) string {
	switch t := v.(type) {
	case int64:
		if t <= 0 {
			return ""
		}
		return strconv.FormatInt(t, 10)
	case float64:
		if t <= 0 {
			return ""
		}
		return strconv.FormatInt(int64(t), 10)
	case string:
		return strings.TrimSpace(t)
	default:
		s := strings.TrimSpace(fmt.Sprint(v))
		if s == "" || s == "<nil>" || s == "0" {
			return ""
		}
		return s
	}
}

func nullableTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	u := t.UTC()
	return &u
}

func parseUUID(v any) uuid.UUID {
	switch t := v.(type) {
	case uuid.UUID:
		return t
	case [16]byte:
		return uuid.UUID(t)
	case string:
		id, err := uuid.Parse(strings.TrimSpace(t))
		if err != nil {
			return uuid.Nil
		}
		return id
	default:
		id, err := uuid.Parse(strings.TrimSpace(fmt.Sprint(v)))
		if err != nil {
			return uuid.Nil
		}
		return id
	}
}

func parseJSONAny(v any) any {
	switch t := v.(type) {
	case []byte:
		var out any
		_ = json.Unmarshal(t, &out)
		return out
	default:
		return v
	}
}

func (s *Service) importLegacyIntelligenceCards(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT c.id, c.title, c.summary, c.event_type, c.product_family_inferred,
		       c.possible_seller, c.possible_buyer, c.confidence, c.severity, c.evidence,
		       c.company_id, c.terminal_id, c.port_call_id, pc.mmsi
		FROM oil_intelligence_cards c
		LEFT JOIN oil_port_calls pc ON pc.id = c.port_call_id
		ORDER BY c.created_at, c.id OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		legacyID := fmt.Sprint(row["id"])
		entityType, entityID := s.resolveIntelCardEntity(ctx, legacy, row)
		if entityID == uuid.Nil {
			return nil
		}
		conf, _ := toFloat(row["confidence"])
		if conf <= 1 {
			conf *= 100
		}
		title := fmt.Sprint(row["title"])
		summary := fmt.Sprint(row["summary"])
		claimValue := title
		if claimValue == "" || claimValue == "<nil>" {
			claimValue = summary
		}
		evidenceJSON, _ := json.Marshal(map[string]any{
			"legacy_card_id":          legacyID,
			"event_type":              row["event_type"],
			"product_family_inferred": row["product_family_inferred"],
			"possible_seller":         row["possible_seller"],
			"possible_buyer":          row["possible_buyer"],
			"severity":                row["severity"],
			"summary":                 summary,
			"source":                  "legacy_import",
		})
		_, err := s.pool.Exec(ctx, `
			INSERT INTO evidence (source_id, entity_type, entity_id, claim_type, claim_value, extracted_text, confidence_score, tier)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'inferred')
			ON CONFLICT (source_id, entity_type, entity_id, claim_type) DO UPDATE SET
				claim_value = EXCLUDED.claim_value,
				extracted_text = EXCLUDED.extracted_text,
				confidence_score = GREATEST(evidence.confidence_score, EXCLUDED.confidence_score)
		`, sourceID, entityType, entityID, "intel_card:"+legacyID, claimValue, string(evidenceJSON), conf)
		return err
	})
}

func (s *Service) importLegacyEntityRelationships(ctx context.Context, legacy *pgxpool.Pool, sourceID uuid.UUID, maxRows int, dryRun bool) (int, error) {
	const q = `
		SELECT fingerprint, source_entity_kind, source_entity_ref, target_entity_kind, target_entity_ref,
		       target_name, relationship_type, relationship_label, ownership_pct, confidence_score,
		       source_name, source_url, source_type, raw_payload, extracted_from
		FROM entity_relationships
		WHERE fingerprint IS NOT NULL AND NULLIF(trim(fingerprint), '') IS NOT NULL
		ORDER BY fingerprint OFFSET $1 LIMIT $2`
	return s.batchLegacyImport(ctx, legacy, maxRows, dryRun, q, func(row map[string]any) error {
		fingerprint := strings.TrimSpace(fmt.Sprint(row["fingerprint"]))
		if fingerprint == "" {
			return nil
		}
		sourceKind := strings.ToLower(fmt.Sprint(row["source_entity_kind"]))
		sourceRef := strings.TrimSpace(fmt.Sprint(row["source_entity_ref"]))
		targetName := normalizeName(fmt.Sprint(row["target_name"]))
		if targetName == "" {
			return nil
		}
		var fromType string
		var fromID uuid.UUID
		switch sourceKind {
		case "license":
			fromType = "asset"
			fromID = s.assetIDByLegacyLicenseRef(ctx, sourceRef)
		default:
			return nil
		}
		if fromID == uuid.Nil {
			return nil
		}
		toID := s.companyIDByName(ctx, targetName, "")
		if toID == uuid.Nil {
			return nil
		}
		relType := mapLegacyRelationshipType(strings.TrimSpace(fmt.Sprint(row["relationship_type"])))
		if relType == "" {
			return nil
		}
		conf := legacyRelationshipScore(mustFloat(row["confidence_score"]))
		meta, _ := json.Marshal(map[string]any{
			"legacy_fingerprint": fingerprint,
			"source_entity_kind": sourceKind,
			"source_entity_ref":  sourceRef,
			"target_name":        targetName,
			"relationship_label": row["relationship_label"],
			"ownership_pct":      row["ownership_pct"],
			"source_name":        row["source_name"],
			"source_url":         row["source_url"],
			"source_type":        row["source_type"],
			"extracted_from":     row["extracted_from"],
			"raw_payload":        parseJSONAny(row["raw_payload"]),
		})
		snippet := targetName
		if label := fmt.Sprint(row["relationship_label"]); label != "" && label != "<nil>" {
			snippet = label
		}
		_, err := s.pool.Exec(ctx, `
			INSERT INTO relationships (
				from_entity_type, from_entity_id, to_entity_type, to_entity_id,
				relationship_type, source_id, confidence_score, evidence_snippet, metadata
			) VALUES ($1, $2, 'company', $3, $4, NULLIF($5::uuid, '00000000-0000-0000-0000-000000000000'), $6, $7, $8)
			ON CONFLICT ((metadata->>'legacy_fingerprint')) WHERE metadata->>'legacy_fingerprint' IS NOT NULL
			DO UPDATE SET
				confidence_score = GREATEST(relationships.confidence_score, EXCLUDED.confidence_score),
				evidence_snippet = COALESCE(NULLIF(EXCLUDED.evidence_snippet, ''), relationships.evidence_snippet)
		`, fromType, fromID, toID, relType, sourceID, conf, snippet, meta)
		return err
	})
}

func mustFloat(v any) float64 {
	f, _ := toFloat(v)
	return f
}

// RunPhaseAImport runs all Phase A intelligence table imports (CLI entry).
func (s *Service) RunPhaseAImport(ctx context.Context, tables []string, maxRows int, dryRun bool) (map[string]int, error) {
	if len(tables) == 0 {
		tables = append([]string{}, legacyIntelligenceTables...)
	}
	legacy, err := s.poolFromLegacy(ctx)
	if err != nil {
		return nil, err
	}
	defer legacy.Close()
	sourceID, _ := s.ensureSource(ctx, "legacy_mining_db")
	counts := map[string]int{}
	var firstErr error
	for _, table := range tables {
		n, err := s.importLegacyIntelligenceTable(ctx, legacy, sourceID, table, maxRows, dryRun)
		counts[table] = n
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return counts, firstErr
}
