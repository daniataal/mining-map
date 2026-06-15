package markets

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	tierPersistedPrice = "persisted_price"
	tierDerivedOpen    = "derived_open_data"

	// Industry approximation: residual/marine fuel MT ≈ crude bbl × barrels-per-MT + crack spread.
	barrelsPerMTFuelOil  = 6.35
	vlsfoCrackSpreadUSD  = 90.0
)

type bunkerQuoteInput struct {
	pool           *pgxpool.Pool
	brentPrice     float64
	brentAvailable bool
	brentTier      string
}

func buildBunkerVLSFOQuote(in bunkerQuoteInput, now time.Time) Quote {
	if in.pool != nil {
		if q, ok := lookupPersistedBunkerPrice(in.pool, now, "vlsfo"); ok {
			return q
		}
	}
	if in.brentAvailable && in.brentPrice > 0 {
		price := in.brentPrice*barrelsPerMTFuelOil + vlsfoCrackSpreadUSD
		disclaimer := fmt.Sprintf(
			"Derived from EIA Brent (%.2f USD/bbl) × %.2f bbl/MT + %.0f USD/MT marine crack spread — indicative, not Singapore desk quote",
			in.brentPrice, barrelsPerMTFuelOil, vlsfoCrackSpreadUSD,
		)
		return Quote{
			Symbol: "VLSFO_SG", Label: "VLSFO Singapore (Brent-derived)",
			Price: price, Currency: "USD", Unit: "/MT",
			Tier: tierDerivedOpen, Disclaimer: disclaimer, ObservedAt: now,
		}
	}

	meta := loadBunkerSeedMeta()
	disclaimer := "Reference stub — no bunker price feed wired; indicative desk baseline only"
	if meta.Loaded {
		disclaimer = fmt.Sprintf(
			"Reference stub — bunker_fuel_suppliers_seed lists %d licensed suppliers across %d hubs (%d VLSFO-capable, %d in Singapore); register has no prices",
			meta.SupplierCount, meta.HubCount, meta.VLSFOSupplierCount, meta.SingaporeSuppliers,
		)
		if meta.SourceAccessed != "" {
			disclaimer += " (register accessed " + meta.SourceAccessed + ")"
		}
	}
	return Quote{
		Symbol: "VLSFO_SG", Label: "VLSFO Singapore",
		Price: vlsfoReferenceUSDMT, Currency: "USD", Unit: "/MT",
		Tier: tierReferenceStub, Disclaimer: disclaimer, ObservedAt: now,
	}
}

func lookupPersistedBunkerPrice(pool *pgxpool.Pool, now time.Time, slug string) (Quote, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var price float64
	var unit, currency, location string
	var observed *time.Time
	var conf *float64
	err := pool.QueryRow(ctx, `
		SELECT p.price, COALESCE(p.unit, 'MT'), COALESCE(p.currency, 'USD'),
		       COALESCE(p.location_name, ''), p.observed_at, p.confidence_score
		FROM prices p
		JOIN commodities c ON c.id = p.commodity_id
		WHERE lower(c.slug) = lower($1)
		ORDER BY p.observed_at DESC NULLS LAST LIMIT 1
	`, slug).Scan(&price, &unit, &currency, &location, &observed, &conf)
	if err != nil || price <= 0 {
		return Quote{}, false
	}
	obs := now
	if observed != nil {
		obs = observed.UTC()
	}
	label := "VLSFO Singapore"
	if location != "" {
		label = "VLSFO " + location
	}
	disclaimer := "Persisted open-data price row from prices table"
	if conf != nil {
		disclaimer += fmt.Sprintf(" (confidence %.0f)", *conf)
	}
	unitSuffix := "/MT"
	if u := strings.TrimSpace(unit); u != "" && !strings.HasPrefix(u, "/") {
		unitSuffix = "/" + strings.ToUpper(u)
	}
	return Quote{
		Symbol: "VLSFO_SG", Label: label, Price: price, Currency: currency, Unit: unitSuffix,
		Tier: tierPersistedPrice, Disclaimer: disclaimer, ObservedAt: obs,
	}, true
}
