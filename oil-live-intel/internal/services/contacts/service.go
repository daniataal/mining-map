package contacts

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Contact struct {
	ID             string   `json:"id,omitempty"`
	ContactType    string   `json:"contact_type"`
	ContactScope   string   `json:"contact_scope,omitempty"`
	Label          string   `json:"label,omitempty"`
	Value          string   `json:"value"`
	SourceName     string   `json:"source_name,omitempty"`
	SourceURL      string   `json:"source_url,omitempty"`
	SourceType     string   `json:"source_type,omitempty"`
	Confidence     *float64 `json:"confidence,omitempty"`
	DiscoveredBy   string   `json:"discovered_by,omitempty"`
	Origin         string   `json:"origin"`
}

type ProcurementNotice struct {
	NoticeID    string  `json:"notice_id"`
	Title       string  `json:"title,omitempty"`
	Buyer       string  `json:"buyer,omitempty"`
	Country     string  `json:"country,omitempty"`
	PublishedAt *string `json:"published_at,omitempty"`
	SourceURL   string  `json:"source_url,omitempty"`
}

type Bundle struct {
	CompanyID       string              `json:"company_id"`
	CompanyName     string              `json:"company_name"`
	SupplierID      string              `json:"supplier_id,omitempty"`
	Contacts        []Contact           `json:"contacts"`
	Procurement     []ProcurementNotice `json:"procurement_notices"`
	ProcurementNote string              `json:"procurement_note,omitempty"`
	Disclaimer      string              `json:"disclaimer"`
}

type AddInput struct {
	ContactType  string
	ContactScope string
	Label        string
	Value        string
	CreatedBy    string
}

func List(ctx context.Context, pool *pgxpool.Pool, companyID uuid.UUID) (Bundle, error) {
	var name, country string
	var website, supplierID *string
	err := pool.QueryRow(ctx, `
		SELECT name, country, website, supplier_id::text
		FROM oil_companies WHERE id = $1
	`, companyID).Scan(&name, &country, &website, &supplierID)
	if err != nil {
		return Bundle{}, fmt.Errorf("company not found")
	}

	out := Bundle{
		CompanyID:   companyID.String(),
		CompanyName: name,
		Contacts:    []Contact{},
		Disclaimer:  "Contacts from public registries, licenses, or analyst entry — verify before outreach.",
	}
	if supplierID != nil && *supplierID != "" {
		out.SupplierID = *supplierID
		rows, err := pool.Query(ctx, `
			SELECT id, contact_type, COALESCE(contact_scope,'public_business'), label, value,
			       source_name, source_url, source_type, confidence_score, discovered_by
			FROM entity_contacts
			WHERE entity_kind = 'license' AND entity_id = $1
			ORDER BY confidence_score DESC NULLS LAST, value ASC
			LIMIT 50
		`, *supplierID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var c Contact
				var id, scope, label, srcName, srcURL, srcType, discovered *string
				var conf *float64
				if err := rows.Scan(&id, &c.ContactType, &scope, &label, &c.Value,
					&srcName, &srcURL, &srcType, &conf, &discovered); err != nil {
					continue
				}
				c.ID = deref(id)
				c.ContactScope = deref(scope)
				c.Label = deref(label)
				c.SourceName = deref(srcName)
				c.SourceURL = deref(srcURL)
				c.SourceType = deref(srcType)
				c.Confidence = conf
				c.DiscoveredBy = deref(discovered)
				c.Origin = "entity_contacts"
				out.Contacts = append(out.Contacts, c)
			}
		}
	}

	if website != nil && strings.TrimSpace(*website) != "" {
		out.Contacts = append(out.Contacts, Contact{
			ContactType:  "website",
			ContactScope: "public_business",
			Label:        "Company website",
			Value:        strings.TrimSpace(*website),
			SourceType:   "oil_company",
			Origin:       "oil_company",
		})
	}

	rows, err := pool.Query(ctx, `
		SELECT id::text, contact_type, contact_scope, label, value, source_type, created_by
		FROM oil_company_contacts WHERE company_id = $1 ORDER BY created_at DESC
	`, companyID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var c Contact
			var id, scope, label, srcType, createdBy *string
			if err := rows.Scan(&id, &c.ContactType, &scope, &label, &c.Value, &srcType, &createdBy); err != nil {
				continue
			}
			c.ID = deref(id)
			c.ContactScope = deref(scope)
			c.Label = deref(label)
			c.SourceType = deref(srcType)
			if c.SourceType == "" {
				c.SourceType = "manual"
			}
			c.DiscoveredBy = deref(createdBy)
			c.Origin = "user_added"
			out.Contacts = append(out.Contacts, c)
		}
	}

	out.Procurement, out.ProcurementNote = matchProcurement(ctx, pool, name, country)
	return out, nil
}

func Add(ctx context.Context, pool *pgxpool.Pool, companyID uuid.UUID, in AddInput) (Contact, error) {
	in.Value = strings.TrimSpace(in.Value)
	if in.Value == "" {
		return Contact{}, fmt.Errorf("value required")
	}
	if in.ContactType == "" {
		in.ContactType = "phone"
	}
	if in.ContactScope == "" {
		in.ContactScope = "public_business"
	}
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO oil_company_contacts (company_id, contact_type, contact_scope, label, value, source_type, created_by)
		VALUES ($1,$2,$3,$4,$5,'manual',$6)
		RETURNING id
	`, companyID, in.ContactType, in.ContactScope, nullIfEmpty(in.Label), in.Value, nullIfEmpty(in.CreatedBy)).Scan(&id)
	if err != nil {
		return Contact{}, err
	}
	return Contact{
		ID:           id.String(),
		ContactType:  in.ContactType,
		ContactScope: in.ContactScope,
		Label:        in.Label,
		Value:        in.Value,
		SourceType:   "manual",
		DiscoveredBy: in.CreatedBy,
		Origin:       "user_added",
	}, nil
}

func matchProcurement(ctx context.Context, pool *pgxpool.Pool, companyName, country string) ([]ProcurementNotice, string) {
	name := strings.TrimSpace(companyName)
	if name == "" {
		return nil, ""
	}
	pattern := "%" + escapeLike(name) + "%"
	rows, err := pool.Query(ctx, `
		SELECT notice_id, title, buyer, country, published_at::text, source_url
		FROM eu_procurement_notices
		WHERE buyer ILIKE $1 OR title ILIKE $1
		ORDER BY published_at DESC NULLS LAST
		LIMIT 24
	`, pattern)
	if err != nil {
		return nil, "EU procurement table not populated — sync via POST /api/admin/eu-procurement/sync on the Python backend."
	}
	defer rows.Close()
	var notices []ProcurementNotice
	for rows.Next() {
		var n ProcurementNotice
		var title, buyer, ctry, pub, url *string
		if err := rows.Scan(&n.NoticeID, &title, &buyer, &ctry, &pub, &url); err != nil {
			continue
		}
		if !nameMatches(name, deref(buyer)) && !nameMatches(name, deref(title)) {
			continue
		}
		if c := strings.TrimSpace(country); c != "" && ctry != nil {
			if !strings.EqualFold(strings.TrimSpace(*ctry), c) &&
				!strings.Contains(strings.ToLower(deref(ctry)), strings.ToLower(c)) {
				continue
			}
		}
		n.Title = deref(title)
		n.Buyer = deref(buyer)
		n.Country = deref(ctry)
		n.PublishedAt = pub
		n.SourceURL = deref(url)
		notices = append(notices, n)
		if len(notices) >= 8 {
			break
		}
	}
	note := ""
	if len(notices) == 0 {
		note = fmt.Sprintf("No TED notices matched '%s'. Heuristic match on buyer/title — verify at ted.europa.eu.", name)
	}
	return notices, note
}

func nameMatches(company, candidate string) bool {
	a := cleanName(company)
	b := cleanName(candidate)
	if a == "" || b == "" {
		return false
	}
	if strings.EqualFold(a, b) {
		return true
	}
	if len(a) >= 4 && strings.Contains(strings.ToLower(b), strings.ToLower(a)) {
		return true
	}
	if len(b) >= 4 && strings.Contains(strings.ToLower(a), strings.ToLower(b)) {
		return true
	}
	na := normalizeName(a)
	nb := normalizeName(b)
	if len(na) >= 4 && len(nb) >= 4 && (strings.Contains(nb, na) || strings.Contains(na, nb)) {
		return true
	}
	return false
}

func cleanName(s string) string {
	return strings.TrimSpace(regexp.MustCompile(`\s+`).ReplaceAllString(s, " "))
}

func normalizeName(s string) string {
	re := regexp.MustCompile(`[^a-z0-9]`)
	return re.ReplaceAllString(strings.ToLower(s), "")
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
