package intel

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mining-map/oil-live-intel/internal/services/geofence"
)

// CardResult is emitted when a card is created.
type CardResult struct {
	ID       uuid.UUID `json:"id"`
	Title    string    `json:"title"`
	EventType string   `json:"event_type"`
}

type GenerateInput struct {
	PortCallID    uuid.UUID
	Terminal      *geofence.Terminal
	MMSI          int64
	VesselName    string
	EventType     string
	ProductFamily string
	DurationHours float64
	DraftIn       float64
	DraftOut      float64
	HasDraft      bool
	EstBarrels    float64
	HasVolume     bool
	Confidence    float64
	Evidence      []string
}

func Generate(ctx context.Context, pool *pgxpool.Pool, in GenerateInput) (*CardResult, error) {
	if in.Terminal == nil {
		return nil, nil
	}
	title := buildTitle(in)
	summary := buildSummary(in)
	possibleSeller := in.Terminal.Operator
	if possibleSeller == "" {
		possibleSeller = "Terminal operator (inferred)"
	}
	evJSON, _ := json.Marshal(in.Evidence)
	var companyID *uuid.UUID
	var cid uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT id FROM oil_companies
		WHERE country = $1 AND (name ILIKE '%' || $2 || '%' OR normalized_name ILIKE '%' || lower($2) || '%')
		ORDER BY confidence DESC LIMIT 1
	`, in.Terminal.Country, strings.Split(in.Terminal.Operator, "/")[0]).Scan(&cid)
	if err == nil {
		companyID = &cid
	}

	cardID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO oil_intelligence_cards (
			id, port_call_id, terminal_id, company_id, title, summary, event_type,
			product_family_inferred, possible_seller, confidence, evidence
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, cardID, in.PortCallID, in.Terminal.ID, companyID, title, summary, in.EventType,
		in.ProductFamily, possibleSeller, in.Confidence, evJSON)
	if err != nil {
		return nil, err
	}
	return &CardResult{ID: cardID, Title: title, EventType: in.EventType}, nil
}

func buildTitle(in GenerateInput) string {
	verb := "visit at"
	switch in.EventType {
	case "possible_loading":
		verb = "possible loading at"
	case "possible_unloading":
		verb = "possible unloading at"
	}
	family := strings.ReplaceAll(in.ProductFamily, "_", " ")
	if family == "" {
		family = "petroleum"
	}
	return fmt.Sprintf("Possible %s %s %s", family, verb, in.Terminal.Name)
}

func buildSummary(in GenerateInput) string {
	vessel := in.VesselName
	if vessel == "" {
		vessel = fmt.Sprintf("MMSI %d", in.MMSI)
	}
	parts := []string{
		fmt.Sprintf("%s at %s (%s).", vessel, in.Terminal.Name, in.Terminal.Country),
		fmt.Sprintf("Event: %s. Duration: %.1f hours.", in.EventType, in.DurationHours),
		fmt.Sprintf("Confidence: %.2f.", in.Confidence),
	}
	if in.HasDraft {
		parts = append(parts, fmt.Sprintf("Draft %.1fm → %.1fm (estimated).", in.DraftIn, in.DraftOut))
	}
	if in.HasVolume {
		parts = append(parts, fmt.Sprintf("Estimated volume ~%.0f barrels (estimated, not confirmed).", in.EstBarrels))
	}
	parts = append(parts, "Inferred from public/free AIS and terminal data — not a confirmed private transaction.")
	return strings.Join(parts, " ")
}
