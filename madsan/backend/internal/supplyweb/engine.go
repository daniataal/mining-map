package supplyweb

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	hopSupplier  = "supplier"
	hopTank      = "tank"
	hopPipeline  = "pipeline"
	hopRefinery  = "refinery"
	hopPort      = "port"
	hopVessel    = "vessel"
	tierObserved = "observed"
	tierInferred = "inferred"
)

type EvidenceRef struct {
	ClaimType  string  `json:"claim_type"`
	Source     string  `json:"source"`
	Tier       string  `json:"tier"`
	Confidence float64 `json:"confidence_score,omitempty"`
	Detail     string  `json:"detail,omitempty"`
}

type Hop struct {
	Role       string        `json:"role"`
	EntityID   string        `json:"entity_id,omitempty"`
	EntityType string        `json:"entity_type,omitempty"`
	Name       string        `json:"name"`
	Tier       string        `json:"tier"`
	Score      float64       `json:"score"`
	Evidence   []EvidenceRef `json:"evidence,omitempty"`
}

type Result struct {
	Supplier            string   `json:"supplier"`
	Location            string   `json:"location"`
	Commodity           string   `json:"commodity"`
	DeliverabilityScore float64  `json:"deliverability_score"`
	Tier                string   `json:"tier"`
	Hops                []Hop    `json:"hops"`
	Limitations         []string `json:"limitations"`
	GeneratedAt         string   `json:"generated_at"`
}

type Engine struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Engine {
	return &Engine{pool: pool}
}

type Query struct {
	Supplier  string
	Location  string
	Commodity string
}

// Evaluate walks supplier → tanks → pipeline → refinery → port → vessel with evidence per hop.
func (e *Engine) Evaluate(ctx context.Context, q Query) (Result, error) {
	out := Result{
		Supplier:    strings.TrimSpace(q.Supplier),
		Location:    strings.TrimSpace(q.Location),
		Commodity:   strings.TrimSpace(q.Commodity),
		Tier:        tierInferred,
		Hops:        []Hop{},
		Limitations: defaultLimitations(),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if e == nil || e.pool == nil {
		out.Limitations = append(out.Limitations, "Database unavailable")
		return out, nil
	}
	if out.Supplier == "" {
		out.Limitations = append(out.Limitations, "No supplier name provided")
		return out, nil
	}

	var companyID uuid.UUID
	var companyName string
	var companyConf float64
	err := e.pool.QueryRow(ctx, `
		SELECT id, name, COALESCE(confidence_score, 0)
		FROM companies
		WHERE name ILIKE $1 OR normalized_name ILIKE lower($1)
		ORDER BY confidence_score DESC NULLS LAST LIMIT 1
	`, "%"+out.Supplier+"%").Scan(&companyID, &companyName, &companyConf)
	if err == nil {
		out.Hops = append(out.Hops, Hop{
			Role: hopSupplier, EntityID: companyID.String(), EntityType: "company",
			Name: companyName, Tier: tierObserved, Score: 15,
			Evidence: []EvidenceRef{{ClaimType: "company_registry", Source: "companies", Tier: tierObserved, Confidence: companyConf}},
		})
	} else {
		out.Hops = append(out.Hops, Hop{
			Role: hopSupplier, Name: out.Supplier, Tier: tierInferred, Score: 5,
			Evidence: []EvidenceRef{{ClaimType: "unverified_supplier", Source: "deal_input", Tier: tierInferred}},
		})
		out.Limitations = append(out.Limitations, "Supplier not matched in company registry")
	}

	locLat, locLng, locAssetID, locName := e.resolveLocation(ctx, out.Location)
	tankTypes := []string{"tank_farm", "tank", "storage", "terminal"}
	if companyID != uuid.Nil {
		if tank := e.nearestOperatedAsset(ctx, companyID, tankTypes, locLat, locLng, 150_000); tank != nil {
			out.Hops = append(out.Hops, *tank)
		} else {
			out.Limitations = append(out.Limitations, "No operated tank/terminal assets linked to supplier")
		}
	}

	var anchorLat, anchorLng float64
	if locLat != 0 && locLng != 0 {
		anchorLat, anchorLng = locLat, locLng
	} else if len(out.Hops) > 1 {
		// use last tank hop if location unknown
	}

	if pipe := e.nearestPipeline(ctx, anchorLat, anchorLng); pipe != nil {
		out.Hops = append(out.Hops, *pipe)
		if ref := e.nearestAssetType(ctx, anchorLat, anchorLng, []string{"refinery"}, 75_000); ref != nil {
			out.Hops = append(out.Hops, *ref)
		}
	} else if anchorLat != 0 {
		out.Limitations = append(out.Limitations, "No pipeline_graph_edges within search radius of location")
	}

	if port := e.nearestAssetType(ctx, anchorLat, anchorLng, []string{"port", "berth", "terminal"}, 50_000); port != nil {
		out.Hops = append(out.Hops, *port)
	} else if locAssetID != "" {
		out.Hops = append(out.Hops, Hop{
			Role: hopPort, EntityID: locAssetID, EntityType: "asset", Name: locName,
			Tier: tierInferred, Score: 10,
			Evidence: []EvidenceRef{{ClaimType: "location_match", Source: "assets", Tier: tierInferred, Detail: out.Location}},
		})
	}

	if vessel := e.recentVesselNear(ctx, anchorLat, anchorLng); vessel != nil {
		out.Hops = append(out.Hops, *vessel)
	} else {
		out.Limitations = append(out.Limitations, "No recent vessel port activity near location (72h window)")
	}

	out.DeliverabilityScore = scoreHops(out.Hops)
	if hasObservedHop(out.Hops) {
		out.Tier = tierObserved
	}
	return out, nil
}

func defaultLimitations() []string {
	return []string{
		"Supply-web is inferred from registry assets and pipeline geometry — not confirmed cargo flow",
		"Pipeline connectivity uses endpoint proximity; flow direction not verified",
	}
}

func hasObservedHop(hops []Hop) bool {
	for _, h := range hops {
		if h.Tier == tierObserved && h.Score >= 10 {
			return true
		}
	}
	return false
}

func scoreHops(hops []Hop) float64 {
	total := 0.0
	for _, h := range hops {
		total += h.Score
	}
	return math.Min(math.Round(total), 100)
}

func (e *Engine) resolveLocation(ctx context.Context, location string) (lat, lng float64, assetID, name string) {
	if location == "" {
		return 0, 0, "", ""
	}
	var id uuid.UUID
	var assetName string
	err := e.pool.QueryRow(ctx, `
		SELECT id, name,
		       COALESCE(latitude, ST_Y(geom::geometry)),
		       COALESCE(longitude, ST_X(geom::geometry))
		FROM assets
		WHERE geom IS NOT NULL
		  AND (name ILIKE $1 OR normalized_name ILIKE lower($1) OR country_code ILIKE $1)
		ORDER BY confidence_score DESC NULLS LAST LIMIT 1
	`, "%"+location+"%").Scan(&id, &assetName, &lat, &lng)
	if err != nil {
		return 0, 0, "", ""
	}
	return lat, lng, id.String(), assetName
}

func (e *Engine) nearestOperatedAsset(ctx context.Context, companyID uuid.UUID, types []string, lat, lng float64, radiusM float64) *Hop {
	const q = `
		SELECT id, name, asset_type,
		       COALESCE(confidence_score, 0),
		       COALESCE(latitude, ST_Y(geom::geometry)),
		       COALESCE(longitude, ST_X(geom::geometry))
		FROM assets
		WHERE operator_company_id = $1
		  AND asset_type = ANY($2)
		  AND geom IS NOT NULL
		ORDER BY
		  CASE WHEN $3 <> 0 AND $4 <> 0 THEN
		    ST_Distance(geom, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)
		  ELSE 0 END ASC,
		  confidence_score DESC NULLS LAST
		LIMIT 1`
	var id uuid.UUID
	var name, assetType string
	var conf, aLat, aLng float64
	if err := e.pool.QueryRow(ctx, q, companyID, types, lat, lng).Scan(&id, &name, &assetType, &conf, &aLat, &aLng); err != nil {
		return nil
	}
	detail := fmt.Sprintf("operated asset type=%s", assetType)
	if lat != 0 {
		detail += fmt.Sprintf("; %.0fm from deal location", haversineM(lat, lng, aLat, aLng))
	}
	return &Hop{
		Role: hopTank, EntityID: id.String(), EntityType: "asset", Name: name,
		Tier: tierObserved, Score: 20,
		Evidence: []EvidenceRef{{ClaimType: "operated_asset", Source: "assets.operator_company_id", Tier: tierObserved, Confidence: conf, Detail: detail}},
	}
}

func (e *Engine) nearestPipeline(ctx context.Context, lat, lng float64) *Hop {
	if lat == 0 && lng == 0 {
		return nil
	}
	const q = `
		SELECT id, COALESCE(osm_id, ''), COALESCE(metadata->>'name', metadata->'tags'->>'name', 'Pipeline segment'),
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist_m
		FROM pipeline_graph_edges
		WHERE geom IS NOT NULL
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 25000)
		ORDER BY dist_m ASC LIMIT 1`
	var id uuid.UUID
	var osmID, name string
	var distM float64
	if err := e.pool.QueryRow(ctx, q, lng, lat).Scan(&id, &osmID, &name, &distM); err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return nil
	}
	return &Hop{
		Role: hopPipeline, EntityID: id.String(), EntityType: "pipeline", Name: name,
		Tier: tierInferred, Score: 18,
		Evidence: []EvidenceRef{{
			ClaimType: "pipeline_proximity", Source: "pipeline_graph_edges", Tier: tierInferred,
			Detail: fmt.Sprintf("osm_id=%s; %.0fm from location", osmID, distM),
		}},
	}
}

func (e *Engine) nearestAssetType(ctx context.Context, lat, lng float64, types []string, radiusM float64) *Hop {
	if lat == 0 && lng == 0 {
		return nil
	}
	const q = `
		SELECT id, name, asset_type, COALESCE(confidence_score, 0),
		       ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist_m
		FROM assets
		WHERE geom IS NOT NULL AND asset_type = ANY($3)
		  AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
		ORDER BY dist_m ASC LIMIT 1`
	var id uuid.UUID
	var name, assetType string
	var conf, distM float64
	if err := e.pool.QueryRow(ctx, q, lng, lat, types, radiusM).Scan(&id, &name, &assetType, &conf, &distM); err != nil {
		return nil
	}
	role := hopPort
	if assetType == "refinery" {
		role = hopRefinery
	}
	return &Hop{
		Role: role, EntityID: id.String(), EntityType: "asset", Name: name,
		Tier: tierInferred, Score: 15,
		Evidence: []EvidenceRef{{
			ClaimType: "asset_proximity", Source: "assets", Tier: tierInferred, Confidence: conf,
			Detail: fmt.Sprintf("type=%s; %.0fm", assetType, distM),
		}},
	}
}

func (e *Engine) recentVesselNear(ctx context.Context, lat, lng float64) *Hop {
	if lat == 0 && lng == 0 {
		return nil
	}
	cutoff := time.Now().UTC().Add(-72 * time.Hour)
	const q = `
		SELECT v.id, COALESCE(v.name, v.mmsi), v.mmsi, v.last_seen_at,
		       ST_Distance(v.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist_m
		FROM vessels v
		WHERE v.geom IS NOT NULL AND v.last_seen_at >= $3
		  AND ST_DWithin(v.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 100000)
		ORDER BY v.last_seen_at DESC, dist_m ASC LIMIT 1`
	var id uuid.UUID
	var name, mmsi string
	var lastSeen time.Time
	var distM float64
	if err := e.pool.QueryRow(ctx, q, lng, lat, cutoff).Scan(&id, &name, &mmsi, &lastSeen, &distM); err != nil {
		return nil
	}
	return &Hop{
		Role: hopVessel, EntityID: id.String(), EntityType: "vessel", Name: name,
		Tier: tierObserved, Score: 12,
		Evidence: []EvidenceRef{{
			ClaimType: "ais_last_seen", Source: "vessels", Tier: tierObserved,
			Detail: fmt.Sprintf("mmsi=%s; last_seen=%s; %.0fm from location", mmsi, lastSeen.UTC().Format(time.RFC3339), distM),
		}},
	}
}

func haversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const earthR = 6371000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLon := rad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthR * math.Asin(math.Sqrt(a))
}
