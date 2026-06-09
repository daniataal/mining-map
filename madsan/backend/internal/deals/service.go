package deals

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/madsan/intelligence/internal/compliance"
	"github.com/madsan/intelligence/internal/confidence"
)

type VerifyInput struct {
	Commodity       string  `json:"commodity"`
	Quantity        float64 `json:"quantity"`
	QuantityUnit    string  `json:"quantity_unit"`
	Location        string  `json:"location"`
	Seller          string  `json:"seller"`
	Buyer           string  `json:"buyer"`
	SellerCountry   string  `json:"seller_country,omitempty"`
	BuyerCountry    string  `json:"buyer_country,omitempty"`
	Incoterm        string  `json:"incoterm"`
	Price           float64 `json:"price"`
	Currency        string  `json:"currency"`
	ClaimedAssetID  string  `json:"claimed_asset_id,omitempty"`
	ClaimedVessel   string  `json:"claimed_vessel_mmsi,omitempty"`
}

type Service struct {
	pool     *pgxpool.Pool
	screener *compliance.Screener
	eiaKey   string
}

func New(pool *pgxpool.Pool, openSanctionsAPIKey, eiaAPIKey string) *Service {
	return &Service{
		pool:     pool,
		screener: compliance.NewScreener(openSanctionsAPIKey),
		eiaKey:   eiaAPIKey,
	}
}

func (s *Service) Verify(ctx context.Context, tenantID *uuid.UUID, in VerifyInput) (map[string]any, error) {
	score := confidence.Score(50, map[string]bool{"has_coordinates": in.Location != ""})
	positive := []string{}
	warnings := []string{}
	redFlags := []string{}
	missing := compliance.EnergyMissingDocuments(in.Commodity)
	questions := []string{
		"Request tank storage receipt",
		"Request terminal operator confirmation",
		"Ask for product origin/refinery proof",
	}

	sellerCountry := in.SellerCountry
	if sellerCountry == "" && in.Seller != "" {
		sellerCountry = s.lookupCompanyCountry(ctx, in.Seller)
	}
	buyerCountry := in.BuyerCountry
	if buyerCountry == "" && in.Buyer != "" {
		buyerCountry = s.lookupCompanyCountry(ctx, in.Buyer)
	}

	if in.Seller != "" {
		var n int
		var conf *float64
		_ = s.pool.QueryRow(ctx, `
			SELECT COUNT(*)::int, MAX(confidence_score) FROM companies
			WHERE name ILIKE $1 OR normalized_name ILIKE lower($1)
		`, "%"+in.Seller+"%").Scan(&n, &conf)
		if n > 0 {
			positive = append(positive, "Seller matches a company in registry")
			score = confidence.Score(score, map[string]bool{"official_website": true})
			if conf != nil && *conf >= 70 {
				positive = append(positive, fmt.Sprintf("Seller registry confidence %.0f", *conf))
			}
		} else {
			warnings = append(warnings, "Seller not found in company registry")
			score = confidence.Score(score, map[string]bool{"weak_single_source": true})
		}
	}

	priceUSD := in.Price
	if strings.ToUpper(in.Currency) != "USD" && in.Price > 0 {
		priceUSD = in.Price // TODO: FX table; treat as USD for KYC threshold until wired
	}

	dd, err := compliance.EvaluateDeal(compliance.DealContext{
		Commodity:     in.Commodity,
		Seller:        in.Seller,
		Buyer:         in.Buyer,
		SellerCountry: sellerCountry,
		BuyerCountry:  buyerCountry,
		Location:      in.Location,
		Quantity:      in.Quantity,
		PriceUSD:      priceUSD,
		ClaimedVessel: in.ClaimedVessel,
	})
	if err == nil {
		score -= dd.ScoreDeduction
		if score < 0 {
			score = 0
		}
		for _, c := range dd.Checks {
			msg := c.Dimension + ": " + c.Message
			switch c.Status {
			case "fail":
				redFlags = append(redFlags, msg)
				score = confidence.Score(score, map[string]bool{"sanctions_risk": true})
			case "warn":
				warnings = append(warnings, msg)
			}
		}
		if dd.Recommendation == "block" {
			questions = append(questions, "Do not proceed without legal/compliance review")
		}
	}

	sanctions := map[string]any{}
	if in.Seller != "" {
		sr := s.screener.ScreenCompany(ctx, in.Seller, 5)
		sanctions["seller"] = sr
		switch sr.Status {
		case "flagged":
			redFlags = append(redFlags, "OpenSanctions potential match for seller — manual review required (not a confirmed sanction)")
			score = confidence.Score(score, map[string]bool{"sanctions_risk": true})
		case "review":
			warnings = append(warnings, "OpenSanctions review-tier match for seller")
		case "unknown":
			warnings = append(warnings, "OpenSanctions screening unavailable for seller")
		}
	}
	if in.Buyer != "" {
		br := s.screener.ScreenCompany(ctx, in.Buyer, 5)
		sanctions["buyer"] = br
		if br.Status == "flagged" {
			redFlags = append(redFlags, "OpenSanctions potential match for buyer — manual review required")
			score = confidence.Score(score, map[string]bool{"sanctions_risk": true})
		}
	}

	if in.ClaimedVessel != "" {
		var name *string
		var lastSeen *time.Time
		err := s.pool.QueryRow(ctx, `
			SELECT name, last_seen_at FROM vessels WHERE mmsi = $1
		`, in.ClaimedVessel).Scan(&name, &lastSeen)
		if err != nil {
			warnings = append(warnings, "Claimed vessel MMSI not found in AIS registry")
		} else {
			positive = append(positive, "Claimed vessel MMSI found: "+deref(name))
			if lastSeen != nil && time.Since(*lastSeen) > 72*time.Hour {
				warnings = append(warnings, "Vessel AIS last seen >72h ago — limited freshness")
			}
		}
	}

	if in.ClaimedAssetID != "" {
		var assetName string
		var conf *float64
		err := s.pool.QueryRow(ctx, `SELECT name, confidence_score FROM assets WHERE id = $1`, in.ClaimedAssetID).Scan(&assetName, &conf)
		if err != nil {
			warnings = append(warnings, "Claimed asset ID not found")
		} else {
			positive = append(positive, "Claimed asset: "+assetName)
		}
	}

	status := confidence.Status(score)
	var dealID uuid.UUID
	title := fmt.Sprintf("%s deal — %s", in.Commodity, in.Location)
	var claimedAssetID, claimedVesselID *uuid.UUID
	if in.ClaimedAssetID != "" {
		if uid, err := uuid.Parse(in.ClaimedAssetID); err == nil {
			claimedAssetID = &uid
		}
	}
	if in.ClaimedVessel != "" {
		var vid uuid.UUID
		if err := s.pool.QueryRow(ctx, `SELECT id FROM vessels WHERE mmsi = $1`, in.ClaimedVessel).Scan(&vid); err == nil {
			claimedVesselID = &vid
		}
	}

	result := map[string]any{
		"confidence_score":      score,
		"confidence_status":     status,
		"positive_evidence":     positive,
		"warnings":              warnings,
		"missing_documents":     missing,
		"red_flags":             redFlags,
		"recommended_questions": questions,
		"dd_checks":             dd.Checks,
		"dd_recommendation":     dd.Recommendation,
		"sanctions_screening":   sanctions,
		"claimed_vessel_mmsi":   in.ClaimedVessel,
		"claimed_asset_id":      in.ClaimedAssetID,
		"limitations": []string{
			"Intelligence only — not legal or trading advice",
			"OpenSanctions matches are leads for review, not confirmed sanctions designations",
			"Vessel-terminal links are inferred from AIS destination/proximity — not cargo confirmation",
		},
	}
	resultJSON, _ := json.Marshal(result)

	err = s.pool.QueryRow(ctx, `
		INSERT INTO deals (tenant_id, title, commodity, quantity, quantity_unit, location_name, seller_name, buyer_name, incoterm, price, currency, verification_score, verification_result, claimed_asset_id, claimed_vessel_id, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'verified')
		RETURNING id
	`, tenantID, title, in.Commodity, in.Quantity, in.QuantityUnit, in.Location, in.Seller, in.Buyer, in.Incoterm, in.Price, in.Currency, score, resultJSON, claimedAssetID, claimedVesselID).Scan(&dealID)
	if err != nil {
		return nil, err
	}
	result["deal_id"] = dealID.String()
	return result, nil
}

func (s *Service) lookupCompanyCountry(ctx context.Context, name string) string {
	var cc *string
	_ = s.pool.QueryRow(ctx, `
		SELECT country_code FROM companies
		WHERE name ILIKE $1 OR normalized_name ILIKE lower($1)
		ORDER BY confidence_score DESC NULLS LAST LIMIT 1
	`, "%"+name+"%").Scan(&cc)
	if cc == nil {
		return ""
	}
	return *cc
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (s *Service) Get(ctx context.Context, id string) (map[string]any, error) {
	var result []byte
	var score *float64
	var title, commodity, status string
	err := s.pool.QueryRow(ctx, `
		SELECT title, commodity, status, verification_score, verification_result FROM deals WHERE id = $1
	`, id).Scan(&title, &commodity, &status, &score, &result)
	if err != nil {
		return nil, err
	}
	out := map[string]any{"id": id, "title": title, "commodity": commodity, "status": status, "verification_score": score}
	if len(result) > 0 {
		var vr map[string]any
		_ = json.Unmarshal(result, &vr)
		out["verification"] = vr
	}
	return out, nil
}

func (s *Service) ExportPack(ctx context.Context, id, format string) ([]byte, string, error) {
	pack, err := s.BuildPack(ctx, id)
	if err != nil {
		return nil, "", err
	}
	switch strings.ToLower(format) {
	case "markdown", "md":
		return []byte(PackToMarkdown(pack)), "text/markdown; charset=utf-8", nil
	case "html":
		return []byte(PackToHTML(pack)), "text/html; charset=utf-8", nil
	default:
		b, err := json.MarshalIndent(pack, "", "  ")
		return b, "application/json", err
	}
}

