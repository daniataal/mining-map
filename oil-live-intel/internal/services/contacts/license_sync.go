package contacts

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	emailRE        = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	urlRE          = regexp.MustCompile(`(?i)^(https?://|www\.)`)
	phoneAllowedRE = regexp.MustCompile(`^[+()0-9.\- /extEXT]+$`)
)

type licenseContactCandidate struct {
	ID              string
	Fingerprint     string
	EntityKind      string
	EntityID        string
	ContactType     string
	ContactScope    string
	Label           string
	Value           string
	NormalizedValue string
	SourceName      string
	SourceURL       string
	SourceType      string
	Confidence      float64
	RawPayload      map[string]any
	ExtractedFrom   string
	VerifiedAt      *time.Time
	DiscoveredBy    string
}

// SyncLicenseContacts mirrors Python sync_license_contacts for license CRUD on Go.
func SyncLicenseContacts(ctx context.Context, pool *pgxpool.Pool, licenseID string) (int, error) {
	if pool == nil || strings.TrimSpace(licenseID) == "" {
		return 0, nil
	}

	var (
		phoneNumber     *string
		recordOrigin    *string
		sourceName      *string
		sourceURL       *string
		sourceRecordURL *string
		sourceUpdatedAt *time.Time
		rawPayload      []byte
		lastSyncedAt    *time.Time
	)
	err := pool.QueryRow(ctx, `
		SELECT phone_number, record_origin, source_name, source_url, source_record_url,
		       source_updated_at, raw_payload, last_synced_at
		FROM licenses WHERE id = $1
	`, licenseID).Scan(
		&phoneNumber, &recordOrigin, &sourceName, &sourceURL, &sourceRecordURL,
		&sourceUpdatedAt, &rawPayload, &lastSyncedAt,
	)
	if err != nil {
		return 0, err
	}

	row := map[string]any{
		"id":                licenseID,
		"phone_number":      derefStr(phoneNumber),
		"record_origin":     derefStr(recordOrigin),
		"source_name":       derefStr(sourceName),
		"source_url":        derefStr(sourceURL),
		"source_record_url": derefStr(sourceRecordURL),
		"source_updated_at": sourceUpdatedAt,
		"last_synced_at":    lastSyncedAt,
		"raw_payload":       decodeRawPayload(rawPayload),
	}

	candidates := buildLicenseContactCandidates(row)
	if len(candidates) == 0 {
		return 0, nil
	}

	_, err = pool.Exec(ctx, `
		DELETE FROM entity_contacts
		WHERE entity_kind = 'license'
		  AND entity_id = $1
		  AND source_type IN ('official_open_data', 'source_backed_record')
		  AND COALESCE(discovered_by, 'open_data') = 'open_data'
	`, licenseID)
	if err != nil {
		return 0, err
	}

	written := 0
	for _, c := range candidates {
		rawJSON, _ := json.Marshal(c.RawPayload)
		tag, err := pool.Exec(ctx, `
			INSERT INTO entity_contacts (
				id, fingerprint, entity_kind, entity_id, contact_type, contact_scope,
				label, value, normalized_value, source_name, source_url, source_type,
				confidence_score, raw_payload, extracted_from, verified_at,
				discovered_by, last_seen_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, CURRENT_TIMESTAMP
			)
			ON CONFLICT (fingerprint) DO UPDATE SET
				label = EXCLUDED.label,
				value = EXCLUDED.value,
				normalized_value = EXCLUDED.normalized_value,
				source_name = EXCLUDED.source_name,
				source_url = EXCLUDED.source_url,
				source_type = EXCLUDED.source_type,
				confidence_score = EXCLUDED.confidence_score,
				raw_payload = EXCLUDED.raw_payload,
				extracted_from = EXCLUDED.extracted_from,
				verified_at = COALESCE(EXCLUDED.verified_at, entity_contacts.verified_at),
				discovered_by = EXCLUDED.discovered_by,
				last_seen_at = CURRENT_TIMESTAMP
		`, c.ID, c.Fingerprint, c.EntityKind, c.EntityID, c.ContactType, c.ContactScope,
			c.Label, c.Value, c.NormalizedValue, c.SourceName, c.SourceURL, c.SourceType,
			c.Confidence, rawJSON, c.ExtractedFrom, c.VerifiedAt, c.DiscoveredBy)
		if err != nil {
			return written, err
		}
		if tag.RowsAffected() > 0 {
			written++
		}
	}
	return written, nil
}

func buildLicenseContactCandidates(row map[string]any) []licenseContactCandidate {
	entityID := cleanText(row["id"])
	if entityID == "" || !hasReliablePublicSource(row) {
		return nil
	}

	sourceName := cleanText(row["source_name"])
	if sourceName == "" {
		sourceName = "Source-backed record"
	}
	sourceURL := cleanText(row["source_record_url"])
	if sourceURL == "" {
		sourceURL = cleanText(row["source_url"])
	}
	sourceType := sourceTypeForRow(row)
	verifiedAt := firstTime(
		parseTime(row["source_updated_at"]),
		parseTime(row["last_synced_at"]),
		parseTime(row["updated_at"]),
	)

	byFingerprint := map[string]licenseContactCandidate{}
	add := func(contactType, value, extractedFrom string, evidence map[string]any) {
		for _, piece := range splitMultiValue(contactType, value) {
			if !isValidContactValue(contactType, piece) {
				continue
			}
			normalized := normalizedContactValue(contactType, piece)
			fp := contactFingerprint("license", entityID, contactType, normalized, sourceName, sourceURL)
			byFingerprint[fp] = licenseContactCandidate{
				ID:              fp,
				Fingerprint:     fp,
				EntityKind:      "license",
				EntityID:        entityID,
				ContactType:     contactType,
				ContactScope:    "public_business",
				Label:           friendlyLabel(contactType, extractedFrom),
				Value:           piece,
				NormalizedValue: normalized,
				SourceName:      sourceName,
				SourceURL:       sourceURL,
				SourceType:      sourceType,
				Confidence:      confidenceForRow(contactType, extractedFrom, sourceType),
				RawPayload:      evidence,
				ExtractedFrom:   extractedFrom,
				VerifiedAt:      verifiedAt,
				DiscoveredBy:    "open_data",
			}
		}
	}

	if phone := cleanText(row["phone_number"]); phone != "" {
		add("phone", phone, "licenses.phone_number", map[string]any{
			"field":         "licenses.phone_number",
			"value":         phone,
			"record_origin": row["record_origin"],
			"source_name":   row["source_name"],
			"source_url":    sourceURL,
		})
	}

	walkRawPayload(row["raw_payload"], "", add)

	out := make([]licenseContactCandidate, 0, len(byFingerprint))
	for _, c := range byFingerprint {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		order := map[string]int{"phone": 0, "email": 1, "website": 2, "address": 3}
		oi := order[out[i].ContactType]
		oj := order[out[j].ContactType]
		if oi != oj {
			return oi < oj
		}
		if out[i].Confidence != out[j].Confidence {
			return out[i].Confidence > out[j].Confidence
		}
		return strings.ToLower(out[i].Value) < strings.ToLower(out[j].Value)
	})
	return out
}

func walkRawPayload(node any, prefix string, add func(string, string, string, map[string]any)) {
	switch v := node.(type) {
	case map[string]any:
		for key, child := range v {
			next := key
			if prefix != "" {
				next = prefix + "." + key
			}
			walkRawPayload(child, next, add)
		}
	case []any:
		for i, child := range v {
			next := fmt.Sprintf("%s[%d]", prefix, i)
			walkRawPayload(child, next, add)
		}
	default:
		if prefix == "" {
			return
		}
		if contactType := classifyContactField(prefix); contactType != "" {
			text := cleanText(v)
			if text != "" {
				add(contactType, text, prefix, map[string]any{
					"field":       prefix,
					"value":       text,
					"source_name": "",
					"source_url":  "",
				})
			}
		}
	}
}

func hasReliablePublicSource(row map[string]any) bool {
	if cleanText(row["source_record_url"]) != "" || cleanText(row["source_url"]) != "" {
		return true
	}
	origin := strings.ToLower(cleanText(row["record_origin"]))
	return origin == "open_data" && cleanText(row["source_name"]) != ""
}

func sourceTypeForRow(row map[string]any) string {
	if strings.ToLower(cleanText(row["record_origin"])) == "open_data" {
		return "official_open_data"
	}
	return "source_backed_record"
}

func confidenceForRow(contactType, extractedFrom, sourceType string) float64 {
	official := map[string]float64{"phone": 0.93, "email": 0.92, "website": 0.89, "address": 0.86}
	fallback := map[string]float64{"phone": 0.78, "email": 0.77, "website": 0.75, "address": 0.72}
	var base float64
	if sourceType == "official_open_data" {
		base = official[contactType]
		if base == 0 {
			base = 0.8
		}
	} else {
		base = fallback[contactType]
		if base == 0 {
			base = 0.68
		}
	}
	if extractedFrom == "licenses.phone_number" {
		return base - 0.06
	}
	return base
}

func classifyContactField(path string) string {
	tokens := normalizeKeyTokens(path)
	if len(tokens) == 0 {
		return ""
	}
	collapsed := strings.Join(tokens, "")
	last := tokens[len(tokens)-1]

	phoneKeys := map[string]struct{}{
		"phone": {}, "phonenumber": {}, "contactphone": {}, "telephone": {}, "tel": {},
	}
	emailKeys := map[string]struct{}{"email": {}, "contactemail": {}, "emailaddress": {}}
	websiteKeys := map[string]struct{}{"website": {}, "homepage": {}, "url": {}, "web": {}}
	addressKeys := map[string]struct{}{"address": {}, "officeaddress": {}, "registeredaddress": {}}

	if _, ok := phoneKeys[collapsed]; ok || last == "phone" || last == "telephone" || last == "tel" {
		return "phone"
	}
	if _, ok := emailKeys[collapsed]; ok || last == "email" {
		return "email"
	}
	if _, ok := websiteKeys[collapsed]; ok || last == "website" || last == "homepage" || last == "url" {
		return "website"
	}
	if _, ok := addressKeys[collapsed]; ok || last == "address" {
		return "address"
	}
	return ""
}

func normalizeKeyTokens(path string) []string {
	re := regexp.MustCompile(`[^a-z0-9]+`)
	parts := re.Split(strings.ToLower(path), -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitMultiValue(contactType, value string) []string {
	if contactType == "address" {
		return []string{value}
	}
	parts := regexp.MustCompile(`[;\n|]+`).Split(value, -1)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return []string{value}
	}
	return out
}

func isValidContactValue(contactType, value string) bool {
	cleaned := cleanText(value)
	if cleaned == "" {
		return false
	}
	switch contactType {
	case "phone":
		digits := regexp.MustCompile(`\D`).ReplaceAllString(cleaned, "")
		return len(digits) >= 7 && len(digits) <= 18 && phoneAllowedRE.MatchString(cleaned)
	case "email":
		return emailRE.MatchString(cleaned)
	case "website":
		return strings.Contains(cleaned, ".") && !strings.Contains(cleaned, " ")
	case "address":
		return len(cleaned) >= 6
	default:
		return false
	}
}

func normalizedContactValue(contactType, value string) string {
	cleaned := cleanText(value)
	switch contactType {
	case "phone":
		digits := regexp.MustCompile(`\D`).ReplaceAllString(cleaned, "")
		if digits != "" {
			return digits
		}
		return strings.ToLower(cleaned)
	case "email":
		return strings.ToLower(cleaned)
	case "website":
		without := regexp.MustCompile(`(?i)^https?://`).ReplaceAllString(cleaned, "")
		return strings.TrimSuffix(strings.ToLower(without), "/")
	default:
		return strings.ToLower(cleaned)
	}
}

func contactFingerprint(entityKind, entityID, contactType, normalized, sourceName, sourceURL string) string {
	raw := strings.Join([]string{
		entityKind, entityID, contactType, normalized,
		strings.ToLower(strings.TrimSpace(sourceName)),
		strings.ToLower(strings.TrimSpace(sourceURL)),
	}, "|")
	sum := sha1.Sum([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + strings.ToLower(s[1:])
}

func friendlyLabel(contactType, extractedFrom string) string {
	leaf := extractedFrom
	if idx := strings.LastIndex(extractedFrom, "."); idx >= 0 {
		leaf = extractedFrom[idx+1:]
	}
	leaf = strings.NewReplacer("_", " ", ":", " ").Replace(leaf)
	leaf = strings.TrimSpace(leaf)
	if leaf == "" {
		return titleCase(contactType)
	}
	switch strings.ToLower(leaf) {
	case "phone", "phone number", "email", "website", "address", "url":
		return titleCase(contactType)
	default:
		return titleCase(leaf)
	}
}

func decodeRawPayload(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func cleanText(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.Join(strings.Fields(t), " ")
	case *string:
		if t == nil {
			return ""
		}
		return strings.Join(strings.Fields(*t), " ")
	default:
		s := strings.TrimSpace(fmt.Sprint(v))
		return s
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func parseTime(v any) *time.Time {
	switch t := v.(type) {
	case nil:
		return nil
	case *time.Time:
		return t
	case time.Time:
		utc := t.UTC()
		return &utc
	default:
		return nil
	}
}

func firstTime(times ...*time.Time) *time.Time {
	for _, t := range times {
		if t != nil {
			return t
		}
	}
	return nil
}
