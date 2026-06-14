package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func loadVesselCommercialContacts(ctx context.Context, pool *pgxpool.Pool, ownerCompanyID, operatorCompanyID, ownerName, operatorName string, ownerProfile map[string]any) []map[string]any {
	if pool == nil {
		return nil
	}
	out := make([]map[string]any, 0, 2)
	seen := map[string]bool{}
	add := func(role, companyID, fallbackName string, profile map[string]any) {
		companyID = strings.TrimSpace(companyID)
		if companyID == "" || seen[role+":"+companyID] {
			return
		}
		seen[role+":"+companyID] = true
		if bundle := loadCompanyContactBundle(ctx, pool, companyID, role, fallbackName, profile); bundle != nil {
			out = append(out, bundle)
		}
	}
	add("registered_owner", ownerCompanyID, ownerName, ownerProfile)
	if operatorCompanyID != ownerCompanyID {
		add("operator_manager", operatorCompanyID, operatorName, nil)
	}
	return out
}

func loadCompanyContactBundle(ctx context.Context, pool *pgxpool.Pool, companyID, role, fallbackName string, profile map[string]any) map[string]any {
	var name, country, website, phone, email string
	var rawBytes []byte
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(name,''), COALESCE(country_code,''), COALESCE(website,''), COALESCE(phone,''), COALESCE(email,''),
		       COALESCE(raw_source_payload,'{}'::jsonb)
		FROM companies
		WHERE id::text = $1
	`, companyID).Scan(&name, &country, &website, &phone, &email, &rawBytes)
	if err != nil {
		if strings.TrimSpace(fallbackName) == "" {
			return nil
		}
		name = strings.TrimSpace(fallbackName)
	}
	rawContacts := contactHintsFromRaw(rawBytes)
	if email == "" {
		email = rawContacts.Email
	}
	if phone == "" {
		phone = rawContacts.Phone
	}
	if website == "" {
		website = rawContacts.Website
	}
	contacts := loadCompanyContactsForBundle(ctx, pool, companyID)
	contacts = appendRawContactCandidate(contacts, rawContacts)
	if name == "" && len(contacts) == 0 && website == "" && phone == "" && email == "" && rawContacts.SourceURL == "" && profileString(profile, "parent_name") == "" {
		return nil
	}
	bundle := map[string]any{
		"role":       role,
		"company_id": companyID,
		"name":       firstNonEmpty(name, strings.TrimSpace(fallbackName)),
		"contacts":   contacts,
		"source":     "madsan_contacts",
		"tier":       "source-backed",
	}
	if country != "" {
		bundle["country_code"] = country
	}
	if profileString(profile, "shipvault_company_id") != "" {
		bundle["shipvault_company_id"] = profileString(profile, "shipvault_company_id")
	}
	if profileString(profile, "parent_name") != "" {
		bundle["parent_name"] = profileString(profile, "parent_name")
	}
	if profileString(profile, "parent_company_id") != "" {
		bundle["parent_company_id"] = profileString(profile, "parent_company_id")
	}
	if profileString(profile, "country") != "" {
		bundle["shipvault_country"] = profileString(profile, "country")
	}
	if profileString(profile, "city") != "" {
		bundle["shipvault_city"] = profileString(profile, "city")
	}
	if website != "" {
		bundle["website"] = website
	}
	if rawContacts.SourceURL != "" {
		bundle["source_url"] = rawContacts.SourceURL
	}
	if rawContacts.RegisterSourceURL != "" {
		bundle["register_source_url"] = rawContacts.RegisterSourceURL
	}
	if rawContacts.SourceRef != "" {
		bundle["source_ref"] = rawContacts.SourceRef
	}
	if phone != "" {
		bundle["phone"] = phone
	}
	if email != "" {
		bundle["email"] = email
	}
	return bundle
}

type rawContactHints struct {
	Name              string
	Email             string
	Phone             string
	Website           string
	SourceURL         string
	RegisterSourceURL string
	SourceRef         string
	Role              string
	Evidence          string
}

func contactHintsFromRaw(raw []byte) rawContactHints {
	if len(raw) == 0 {
		return rawContactHints{}
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return rawContactHints{}
	}
	metadata := mapField(payload, "metadata")
	rawPayload := mapField(payload, "raw_payload")
	rawMetadata := mapField(rawPayload, "metadata")
	eiaLatest := mapField(payload, "eia_company_imports_latest")
	get := func(keys ...string) string {
		for _, key := range keys {
			for _, m := range []map[string]any{payload, metadata, rawPayload, rawMetadata, eiaLatest} {
				if v := stringMapValue(m, key); v != "" {
					return v
				}
			}
		}
		return ""
	}
	email := strings.ToLower(get("email", "contact_email", "mail"))
	phone := get("phone", "phone_number", "telephone", "tel", "mobile")
	sourceURL := get("source_url", "url")
	registerURL := get("register_source_url", "registry_url", "register_url")
	sourceRef := firstNonEmpty(get("license_id", "source_line_id", "external_id", "lei", "registry_id"), eiaImportSourceRef(eiaLatest))
	return rawContactHints{
		Name:              get("contact_name", "contact_person", "contact"),
		Email:             email,
		Phone:             phone,
		Website:           get("website", "company_url", "homepage", "web"),
		SourceURL:         sourceURL,
		RegisterSourceURL: registerURL,
		SourceRef:         sourceRef,
		Role:              firstNonEmpty(get("role", "supplier_type", "company_type"), "source_contact"),
		Evidence:          firstNonEmpty(registerURL, sourceURL, sourceRef),
	}
}

func appendRawContactCandidate(contacts []map[string]any, raw rawContactHints) []map[string]any {
	if raw.Email == "" && raw.Phone == "" && raw.SourceURL == "" && raw.RegisterSourceURL == "" && raw.SourceRef == "" {
		return contacts
	}
	for _, contact := range contacts {
		if raw.Email != "" && strings.EqualFold(stringFromAny(contact["email"]), raw.Email) {
			return contacts
		}
		if raw.Phone != "" && normalizePhoneForCompare(stringFromAny(contact["phone"])) == normalizePhoneForCompare(raw.Phone) {
			return contacts
		}
		if raw.Evidence != "" && stringFromAny(contact["evidence"]) == raw.Evidence {
			return contacts
		}
	}
	row := map[string]any{
		"name":                raw.Name,
		"email":               raw.Email,
		"phone":               raw.Phone,
		"role":                raw.Role,
		"evidence":            raw.Evidence,
		"confidence_score":    0.88,
		"verification_status": "source_backed",
		"source":              "company_raw_payload",
	}
	if raw.RegisterSourceURL != "" {
		row["register_source_url"] = raw.RegisterSourceURL
	}
	if raw.SourceURL != "" {
		row["source_url"] = raw.SourceURL
	}
	if raw.SourceRef != "" {
		row["source_ref"] = raw.SourceRef
	}
	return append(contacts, row)
}

func eiaImportSourceRef(eiaLatest map[string]any) string {
	if eiaLatest == nil {
		return ""
	}
	parts := []string{
		"eia_company_imports",
		stringMapValue(eiaLatest, "month"),
		stringMapValue(eiaLatest, "port_code"),
		stringMapValue(eiaLatest, "product_code"),
	}
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			out = append(out, strings.TrimSpace(part))
		}
	}
	return strings.Join(out, ":")
}

func mapField(m map[string]any, key string) map[string]any {
	if m == nil {
		return nil
	}
	if child, ok := m[key].(map[string]any); ok {
		return child
	}
	return nil
}

func stringMapValue(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	return stringFromAny(m[key])
}

func profileString(profile map[string]any, key string) string {
	if profile == nil {
		return ""
	}
	return stringFromAny(profile[key])
}

func normalizePhoneForCompare(phone string) string {
	replacer := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "")
	return replacer.Replace(phone)
}

func loadCompanyContactsForBundle(ctx context.Context, pool *pgxpool.Pool, companyID string) []map[string]any {
	rows, err := pool.Query(ctx, `
		SELECT COALESCE(name,''), COALESCE(email,''), COALESCE(phone,''), COALESCE(role,''),
		       COALESCE(evidence_snippet,''), COALESCE(confidence_score,0), COALESCE(verification_status,'')
		FROM contacts
		WHERE company_id::text = $1
		ORDER BY confidence_score DESC NULLS LAST, created_at DESC
		LIMIT 8
	`, companyID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var name, email, phone, role, evidence, status string
		var confidence float64
		if err := rows.Scan(&name, &email, &phone, &role, &evidence, &confidence, &status); err != nil {
			continue
		}
		row := map[string]any{
			"name": name, "email": email, "phone": phone, "role": role,
			"evidence": evidence, "confidence_score": confidence, "verification_status": status,
		}
		if strings.HasPrefix(evidence, "http://") || strings.HasPrefix(evidence, "https://") {
			row["source_url"] = evidence
		}
		if strings.TrimSpace(email) == "" && strings.TrimSpace(phone) == "" && strings.TrimSpace(evidence) == "" {
			row["detail"] = fmt.Sprintf("%s contact row has no direct channel", firstNonEmpty(role, "company"))
		}
		out = append(out, row)
	}
	return out
}
