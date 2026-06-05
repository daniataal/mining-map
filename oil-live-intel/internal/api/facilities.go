package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type AssetSummary struct {
	ID              string  `json:"id"`
	AssetType       string  `json:"asset_type"`
	Name            string  `json:"name"`
	Country         string  `json:"country,omitempty"`
	Region          string  `json:"region,omitempty"`
	CommodityFamily string  `json:"commodity_family,omitempty"`
	CapacityValue   float64 `json:"capacity_value,omitempty"`
	CapacityUnit    string  `json:"capacity_unit,omitempty"`
	SourceKey       string  `json:"source_key,omitempty"`
}

type AssetDossier struct {
	AssetSummary
	Relationships []Relationship `json:"relationships"`
	Contacts      []Contact      `json:"contacts"`
}

type Relationship struct {
	OrganizationID    string  `json:"organization_id"`
	OrganizationName  string  `json:"organization_name"`
	RelationshipRole  string  `json:"relationship_role"`
	RelationshipLabel string  `json:"relationship_label,omitempty"`
	SourceKey         string  `json:"source_key,omitempty"`
	Confidence        float64 `json:"confidence,omitempty"`
}

type Contact struct {
	ContactType        string `json:"contact_type"`
	ContactRole        string `json:"contact_role,omitempty"`
	Value              string `json:"value"`
	SourceKey          string `json:"source_key,omitempty"`
	VerificationStatus string `json:"verification_status,omitempty"`
}

func (s *Server) ListAssets(w http.ResponseWriter, r *http.Request) {
	assetType := r.URL.Query().Get("type")
	country := r.URL.Query().Get("country")

	query := `
			SELECT id, asset_type, name, country, region, commodity_family,
			       COALESCE(capacity_value, 0), COALESCE(capacity_unit, ''), COALESCE(source_key, '')
			FROM core_assets
			WHERE 1=1
		`
	args := []interface{}{}
	argIdx := 1

	if assetType != "" {
		query += ` AND asset_type = $` + strconv.Itoa(argIdx)
		args = append(args, assetType)
		argIdx++
	}
	if country != "" {
		query += ` AND country = $` + strconv.Itoa(argIdx)
		args = append(args, country)
		argIdx++
	}
	query += ` ORDER BY name ASC LIMIT 100`

	rows, err := s.Pool.Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var results []AssetSummary
	for rows.Next() {
		var a AssetSummary
		if err := rows.Scan(&a.ID, &a.AssetType, &a.Name, &a.Country, &a.Region, &a.CommodityFamily, &a.CapacityValue, &a.CapacityUnit, &a.SourceKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		results = append(results, a)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func (s *Server) GetAssetDossier(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}

	var dossier AssetDossier
	err := s.Pool.QueryRow(r.Context(), `
			SELECT id, asset_type, name, country, region, commodity_family,
			       COALESCE(capacity_value, 0), COALESCE(capacity_unit, ''), COALESCE(source_key, '')
			FROM core_assets
			WHERE id = $1
		`, id).Scan(&dossier.ID, &dossier.AssetType, &dossier.Name, &dossier.Country, &dossier.Region, &dossier.CommodityFamily, &dossier.CapacityValue, &dossier.CapacityUnit, &dossier.SourceKey)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Fetch Relationships
	relRows, err := s.Pool.Query(r.Context(), `
			SELECT r.organization_id, o.name, r.relationship_role, COALESCE(r.relationship_label, ''), COALESCE(r.source_key, ''), COALESCE(r.confidence, 0)
			FROM core_asset_relationships r
			JOIN core_organizations o ON r.organization_id = o.id
			WHERE r.asset_id = $1
		`, id)
	if err == nil {
		defer relRows.Close()
		for relRows.Next() {
			var rel Relationship
			if err := relRows.Scan(&rel.OrganizationID, &rel.OrganizationName, &rel.RelationshipRole, &rel.RelationshipLabel, &rel.SourceKey, &rel.Confidence); err == nil {
				dossier.Relationships = append(dossier.Relationships, rel)
			}
		}
	}

	// Fetch Contacts
	contactRows, err := s.Pool.Query(r.Context(), `
			SELECT contact_type, COALESCE(contact_role, ''), value, COALESCE(source_key, ''), verification_status
			FROM core_contacts
			WHERE asset_id = $1
		`, id)
	if err == nil {
		defer contactRows.Close()
		for contactRows.Next() {
			var c Contact
			if err := contactRows.Scan(&c.ContactType, &c.ContactRole, &c.Value, &c.SourceKey, &c.VerificationStatus); err == nil {
				dossier.Contacts = append(dossier.Contacts, c)
			}
		}
	}

	if dossier.Relationships == nil {
		dossier.Relationships = []Relationship{}
	}
	if dossier.Contacts == nil {
		dossier.Contacts = []Contact{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dossier)
}
