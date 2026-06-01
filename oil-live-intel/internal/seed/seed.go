package seed

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func demoSeedDisabled() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("OIL_LIVE_DISABLE_DEMO_SEED")))
	if v == "" {
		return true
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func RunIfEmpty(ctx context.Context, pool *pgxpool.Pool) error {
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM oil_terminals`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	return Apply(ctx, pool)
}

func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	terminals := []terminalSeed{
		{Name: "Fujairah Oil Industry Zone (FOIZ)", Operator: "VTTI / Fujairah Oil Terminal", Country: "United Arab Emirates", Port: "Fujairah", City: "Fujairah", Lat: 25.128, Lon: 56.337, Products: []string{"crude_oil", "fuel_oil", "refined_products"}, Type: "storage_terminal"},
		{Name: "Port of Rotterdam Tank Storage", Operator: "Vopak", Country: "Netherlands", Port: "Rotterdam", City: "Rotterdam", Lat: 51.95, Lon: 4.05, Products: []string{"diesel", "gasoline", "refined_products"}, Type: "tank_farm"},
		{Name: "Houston Ship Channel Storage Hub", Operator: "Oiltanking", Country: "United States", Port: "Houston", City: "Houston", Lat: 29.73, Lon: -95.27, Products: []string{"crude_oil", "petroleum"}, Type: "storage_terminal"},
		{Name: "Jurong Island Petroleum Hub", Operator: "Vopak", Country: "Singapore", Port: "Singapore", City: "Jurong", Lat: 1.27, Lon: 103.70, Products: []string{"crude_oil", "refined_products", "petrochemical"}, Type: "storage_terminal"},
		{Name: "Ras Tanura Export Terminal", Operator: "Saudi Aramco", Country: "Saudi Arabia", Port: "Ras Tanura", City: "Eastern Province", Lat: 26.707, Lon: 50.061, Products: []string{"crude_oil"}, Type: "export_terminal"},
		{Name: "Vancouver Sulphur Export Terminal", Operator: "Pacific Coast Terminals", Country: "Canada", Port: "Vancouver", City: "Vancouver", Lat: 49.28, Lon: -123.12, Products: []string{"sulfur"}, Type: "bulk_terminal"},
	}

	terminalIDs := make(map[string]uuid.UUID)
	for _, t := range terminals {
		id := uuid.New()
		terminalIDs[t.Name] = id
		_, err := pool.Exec(ctx, `
			INSERT INTO oil_terminals (id, name, terminal_type, operator_name, country, port, city, products, source, confidence, geom)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'curated_seed',0.85,
				ST_SetSRID(ST_MakePoint($9,$10),4326))
		`, id, t.Name, t.Type, t.Operator, t.Country, t.Port, t.City, t.Products, t.Lon, t.Lat)
		if err != nil {
			return fmt.Errorf("insert terminal %s: %w", t.Name, err)
		}
		if err := upsertCompany(ctx, pool, t.Operator, "terminal_operator", t.Country, 0.72); err != nil {
			return err
		}
	}

	companies := []companySeed{
		{Name: "Vopak", Type: "storage_company", Country: "Netherlands", Website: "https://www.vopak.com"},
		{Name: "ADNOC", Type: "terminal_operator", Country: "United Arab Emirates", Website: "https://www.adnoc.ae"},
		{Name: "Saudi Aramco", Type: "terminal_operator", Country: "Saudi Arabia", Website: "https://www.aramco.com"},
		{Name: "Oiltanking", Type: "storage_company", Country: "Germany", Website: "https://www.oiltanking.com"},
		{Name: "Europort Rotterdam", Type: "port_operator", Country: "Netherlands", Website: "https://www.europort.nl"},
	}
	for _, c := range companies {
		if err := upsertCompany(ctx, pool, c.Name, c.Type, c.Country, 0.68); err != nil {
			return err
		}
	}

	if demoSeedDisabled() {
		return nil
	}

	return applyDemoSeeds(ctx, pool, terminalIDs)
}

func applyDemoSeeds(ctx context.Context, pool *pgxpool.Pool, terminalIDs map[string]uuid.UUID) error {
	rtID := terminalIDs["Ras Tanura Export Terminal"]
	rotterdamID := terminalIDs["Port of Rotterdam Tank Storage"]
	now := time.Now().UTC()
	arrival := now.Add(-32 * time.Hour)
	departure := now.Add(-4 * time.Hour)
	portCallID := uuid.New()
	evidence, _ := json.Marshal([]string{
		"Vessel stopped inside terminal geometry",
		"Stay duration: 28.0 hours",
		"Draft increased from 8.2m to 14.8m (estimated)",
		"Vessel classified as crude oil tanker",
		"Terminal tagged as crude export hub",
		"DEMO SEED — synthetic AIS-style port call for map wiring",
	})
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_port_calls (
			id, mmsi, vessel_name, terminal_id, arrival_ts, departure_ts, duration_hours,
			draft_in, draft_out, draft_delta, event_type, product_family_inferred,
			estimated_volume_barrels, confidence, status, evidence
		) VALUES ($1,636012345,'MT DEMO STAR',$2,$3,$4,28,8.2,14.8,6.6,'possible_loading','crude_oil',
			850000,0.82,'closed',$5)
	`, portCallID, rtID, arrival, departure, evidence)
	if err != nil {
		return fmt.Errorf("insert demo port call: %w", err)
	}

	// DEMO SEED — paired discharge visit for Recipe B corridor trade (MT DEMO STAR / MMSI 636012345)
	importArrival := now.Add(-18 * time.Hour)
	importDeparture := now.Add(-6 * time.Hour)
	importEvidence, _ := json.Marshal([]string{
		"DEMO SEED — synthetic paired port call for corridor trade demo",
		"Draft decreased from 14.6m to 9.1m (estimated discharge)",
		"Linked to MT DEMO STAR loading at Ras Tanura for Recipe B corridor",
	})
	importPortCallID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_port_calls (
			id, mmsi, vessel_name, terminal_id, arrival_ts, departure_ts, duration_hours,
			draft_in, draft_out, draft_delta, event_type, product_family_inferred,
			estimated_volume_barrels, confidence, status, evidence
		) VALUES ($1,636012345,'MT DEMO STAR',$2,$3,$4,12,14.6,9.1,-5.5,'possible_unloading','crude_oil',
			820000,0.79,'closed',$5)
	`, importPortCallID, rotterdamID, importArrival, importDeparture, importEvidence)
	if err != nil {
		return fmt.Errorf("insert demo corridor port call: %w", err)
	}

	var companyID uuid.UUID
	err = pool.QueryRow(ctx, `
		SELECT id FROM oil_companies WHERE normalized_name = $1 AND country = $2 LIMIT 1
	`, normalize("Saudi Aramco"), "Saudi Arabia").Scan(&companyID)
	if err != nil {
		companyID = uuid.Nil
	}

	cardEvidence, _ := json.Marshal([]string{
		"Inferred from public AIS-style demo data — not a confirmed private transaction",
		"Vessel MT DEMO STAR at Ras Tanura",
		"Draft change consistent with possible loading",
	})
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_intelligence_cards (
			id, port_call_id, terminal_id, company_id, title, summary, event_type,
			product_family_inferred, possible_seller, confidence, evidence, raw_context
		) VALUES ($1,$2,$3,$4,
			'Possible crude loading at Ras Tanura export terminal',
			'Demo intelligence: MT DEMO STAR may have loaded crude at Ras Tanura. Estimated volume ~850,000 bbl (estimated). Confidence 0.82. This is inferred from public/free data.',
			'possible_loading','crude_oil','Saudi Aramco (operator, inferred)',0.82,$5,'{}')
	`, uuid.New(), portCallID, rtID, companyID, cardEvidence)
	if err != nil {
		return fmt.Errorf("insert demo card: %w", err)
	}

	// Demo vessel + position for map
	_, _ = pool.Exec(ctx, `
		INSERT INTO oil_vessels (mmsi, name, vessel_type, tanker_class, crude_capable, deadweight_tons, max_draft_m)
		VALUES (636012345,'MT DEMO STAR','Tanker','crude',true,300000,16.5)
		ON CONFLICT (mmsi) DO NOTHING`)
	_, _ = pool.Exec(ctx, `
		INSERT INTO oil_ais_positions (mmsi, ts, lat, lon, speed, draft_m, geom)
		VALUES (636012345,$1,26.65,50.10,0.2,14.8, ST_SetSRID(ST_MakePoint(50.10,26.65),4326))
	`, now.Add(-1*time.Hour))

	oppEvidence, _ := json.Marshal([]string{
		"Demo seed — MT DEMO STAR possible loading at Ras Tanura",
		"Inferred from public-style demo data — not a confirmed transaction",
	})
	oppChecklist, _ := json.Marshal(defaultProfitChecklist())
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_opportunities (
			opportunity_type, mmsi, terminal_id, port_call_id, title, hypothesis,
			confidence, evidence, profit_checklist, status, expires_at
		)
		SELECT
			'possible_cargo_flip', 636012345, $1, $2,
			'Possible crude flip at Ras Tanura export terminal',
			'Demo: MT DEMO STAR may have loaded crude at Ras Tanura — click terminal on map for Deal Execution Pack.',
			0.78, $3, $4, 'open', now() + interval '30 days'
		WHERE NOT EXISTS (
			SELECT 1 FROM oil_opportunities
			WHERE opportunity_type = 'possible_cargo_flip'
			  AND mmsi = 636012345
			  AND terminal_id = $1
			  AND status = 'open'
		)
	`, rtID, portCallID, oppEvidence, oppChecklist)
	if err != nil {
		return fmt.Errorf("insert demo opportunity: %w", err)
	}

	return EnsureHormuzCrisisDemoMCR(ctx, pool)
}

func defaultProfitChecklist() []string {
	return []string{
		"Confirm cargo grade and volume with operator (not inferred AIS alone)",
		"Obtain indicative buy and sell prices",
		"Quote freight or demurrage if relevant",
		"Validate storage or terminal slot availability and tariff",
		"Run counterparty credit and sanctions screening",
	}
}

type terminalSeed struct {
	Name, Operator, Country, Port, City, Type string
	Lat, Lon                                   float64
	Products                                   []string
}

type companySeed struct {
	Name, Type, Country, Website string
}

func upsertCompany(ctx context.Context, pool *pgxpool.Pool, name, companyType, country string, conf float64) error {
	norm := normalize(name)
	_, err := pool.Exec(ctx, `
		INSERT INTO oil_companies (name, normalized_name, company_type, country, source, confidence, supplier_status)
		VALUES ($1,$2,$3,$4,'terminal_import',$5,'candidate')
		ON CONFLICT (normalized_name, country) DO UPDATE SET
			confidence = GREATEST(oil_companies.confidence, EXCLUDED.confidence),
			updated_at = now()
	`, name, norm, companyType, country, conf)
	return err
}

func normalize(s string) string {
	return strings.ToLower(strings.TrimSpace(strings.Join(strings.Fields(s), " ")))
}
