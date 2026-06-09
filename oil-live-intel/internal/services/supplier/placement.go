package supplier

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/services/geocode"
)

const (
	GeocodeTierRegisterAddress = "register_address_geocoded"
	GeocodeTierOSMFacility     = "osm_facility_match"
	GeocodeTierPortHubAnchor   = "port_hub_anchor"
)

// PlacementOptions controls geocode and fallback behavior during sync.
type PlacementOptions struct {
	Geocoder *geocode.Client
	Pool     *pgxpool.Pool
}

// ApplyPlacementMetadata sets display_lat/lng and geocode tier fields on company metadata.
func ApplyPlacementMetadata(ctx context.Context, meta map[string]any, row SupplierRecord, opts PlacementOptions) map[string]any {
	if meta == nil {
		meta = map[string]any{}
	}
	address := strings.TrimSpace(row.Address)
	geocodeDisabled := strings.EqualFold(os.Getenv("BUNKER_GEOCODE_DISABLED"), "true")
	if address != "" && opts.Geocoder != nil && !geocodeDisabled {
		if hit, err := opts.Geocoder.LookupRegisterAddress(address, row.Country); err == nil && hit != nil {
			meta["display_lat"] = hit.Lat
			meta["display_lng"] = hit.Lng
			meta["geocode_tier"] = GeocodeTierRegisterAddress
			meta["geocode_source"] = address
			meta["geocode_confidence"] = clampGeocodeConfidence(hit.Confidence)
			meta["geocode_disclaimer"] = "Marker from official register address; verify before site visit"
			return meta
		}
	}

	if opts.Pool != nil {
		if lat, lng, ok := MatchOSMFacility(ctx, opts.Pool, row); ok {
			meta["display_lat"] = lat
			meta["display_lng"] = lng
			meta["geocode_tier"] = GeocodeTierOSMFacility
			meta["geocode_source"] = row.CompanyName
			meta["geocode_confidence"] = 0.72
			meta["geocode_disclaimer"] = "Marker matched to OSM petroleum facility near port; not confirmed office"
			return meta
		}
	}

	if row.HubLat != nil && row.HubLng != nil {
		meta["display_lat"] = *row.HubLat
		meta["display_lng"] = *row.HubLng
		meta["geocode_tier"] = GeocodeTierPortHubAnchor
		meta["geocode_source"] = row.Locode
		meta["geocode_confidence"] = 0.55
		meta["geocode_disclaimer"] = "Port licensed supplier; marker is hub anchor (no published office address on register)"
	}
	return meta
}

func normalizeGeocodeQuery(address, country string) string {
	q := strings.ReplaceAll(address, "#", " ")
	q = strings.Join(strings.Fields(q), " ")
	if country != "" && !strings.Contains(strings.ToLower(q), strings.ToLower(country)) {
		q += ", " + country
	}
	return q
}

func clampGeocodeConfidence(v float64) float64 {
	if v < 0.75 {
		return 0.75
	}
	if v > 0.85 {
		return 0.85
	}
	return v
}

// MatchOSMFacility finds a petroleum OSM feature near the hub matching company name.
func MatchOSMFacility(ctx context.Context, pool *pgxpool.Pool, row SupplierRecord) (lat, lng float64, ok bool) {
	if row.HubLat == nil || row.HubLng == nil {
		return 0, 0, false
	}
	hubLat, hubLng := *row.HubLat, *row.HubLng
	delta := 0.35
	pattern := "%" + strings.ReplaceAll(strings.ToLower(row.CompanyName), " ", "%") + "%"
	if len(pattern) < 4 {
		return 0, 0, false
	}

	err := pool.QueryRow(ctx, `
		SELECT ST_Y(f.geom::geometry), ST_X(f.geom::geometry)
		FROM petroleum_osm_features f
		WHERE f.layer_id IN ('refineries', 'storage_terminals')
		  AND f.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
		  AND (
		    LOWER(COALESCE(f.tags->>'name', '')) LIKE $5
		    OR LOWER(COALESCE(f.tags->>'operator', '')) LIKE $5
		  )
		ORDER BY f.geom <-> ST_SetSRID(ST_MakePoint($6, $7), 4326)
		LIMIT 1
	`, hubLng-delta, hubLat-delta, hubLng+delta, hubLat+delta, pattern, hubLng, hubLat).Scan(&lat, &lng)
	if err != nil {
		return 0, 0, false
	}
	return lat, lng, true
}

func GeocodeDisclaimer(tier string) string {
	switch tier {
	case GeocodeTierRegisterAddress:
		return "Marker from official register address; verify before site visit"
	case GeocodeTierOSMFacility:
		return "Marker matched to OSM petroleum facility near port; not confirmed office"
	case GeocodeTierPortHubAnchor:
		return "Port licensed supplier; marker is hub anchor (no published office address on register)"
	default:
		return ""
	}
}

func FloatFromMeta(meta map[string]any, key string) (float64, bool) {
	v, ok := meta[key]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	default:
		f, err := strconv.ParseFloat(fmt.Sprint(t), 64)
		return f, err == nil
	}
}
