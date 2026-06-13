package ingestion

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"

	"github.com/madsan/intelligence/internal/sources"
)

const (
	eiaCompanyImportsJobType   = "eia_company_imports"
	eiaCompanyImportsSourceKey = "eia_company_imports"
	eiaCompanyImportsIndexURL  = "https://www.eia.gov/petroleum/imports/companylevel/"
)

type EIACompanyImportsOptions struct {
	URL      string   `json:"url,omitempty"`
	URLs     []string `json:"urls,omitempty"`
	IndexURL string   `json:"index_url,omitempty"`
	MaxFiles int      `json:"max_files,omitempty"`
	Force    bool     `json:"force,omitempty"`
}

type EIACompanyImportsResult struct {
	Files          int    `json:"files"`
	RowsRead       int    `json:"rows_read"`
	RowsWritten    int    `json:"rows_written"`
	Companies      int    `json:"companies"`
	SkippedFiles   int    `json:"skipped_files"`
	LatestMonth    string `json:"latest_month,omitempty"`
	DurationMillis int64  `json:"duration_ms"`
}

type EIACompanyImportRecord struct {
	Month          time.Time
	ImporterName   string
	LineNumber     string
	ProductCode    string
	ProductName    string
	ProductFamily  string
	PortCode       string
	PortName       string
	PortState      string
	PortPADD       string
	OriginCode     string
	OriginCountry  string
	OriginISO      string
	Quantity       float64
	Sulfur         *float64
	APIGravity     *float64
	ProcessingName string
	Raw            map[string]string
	RowNumber      int
}

func (s *Service) processEIACompanyImports(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := EIACompanyImportsOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ImportEIACompanyImports(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) ImportEIACompanyImports(ctx context.Context, opts EIACompanyImportsOptions) (EIACompanyImportsResult, error) {
	started := time.Now()
	client := sources.HTTPClient()
	urls := normalizeEIACompanyImportURLs(opts)
	if len(urls) == 0 {
		maxFiles := opts.MaxFiles
		if maxFiles <= 0 {
			maxFiles = 1
		}
		indexURL := strings.TrimSpace(opts.IndexURL)
		if indexURL == "" {
			indexURL = eiaCompanyImportsIndexURL
		}
		var err error
		urls, err = discoverEIACompanyImportURLs(ctx, client, indexURL, maxFiles)
		if err != nil {
			return EIACompanyImportsResult{}, err
		}
	}

	result := EIACompanyImportsResult{}
	for _, sourceURL := range urls {
		body, err := fetchEIACompanyImportWorkbook(ctx, client, sourceURL)
		if err != nil {
			return result, err
		}
		checksum := sha256.Sum256(body)
		checksumHex := hex.EncodeToString(checksum[:])
		records, err := parseEIACompanyImportWorkbook(bytes.NewReader(body))
		if err != nil {
			return result, fmt.Errorf("parse %s: %w", sourceURL, err)
		}
		result.Files++
		result.RowsRead += len(records)
		for _, rec := range records {
			if rec.Month.After(parseResultMonth(result.LatestMonth)) {
				result.LatestMonth = formatMonth(rec.Month)
			}
		}
		releaseID, skipped, err := s.prepareEIACompanyImportRelease(ctx, sourceURL, checksumHex, int64(len(records)), records, opts.Force)
		if err != nil {
			return result, err
		}
		if skipped {
			result.SkippedFiles++
			continue
		}
		written, companies, err := s.persistEIACompanyImports(ctx, sourceURL, releaseID, records)
		if err != nil {
			_ = s.markSourceReleaseFailed(ctx, releaseID, err)
			return result, err
		}
		result.RowsWritten += written
		result.Companies += companies
	}
	result.DurationMillis = time.Since(started).Milliseconds()
	return result, nil
}

func normalizeEIACompanyImportURLs(opts EIACompanyImportsOptions) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || seen[raw] {
			return
		}
		seen[raw] = true
		out = append(out, raw)
	}
	add(opts.URL)
	for _, raw := range opts.URLs {
		add(raw)
	}
	return out
}

func discoverEIACompanyImportURLs(ctx context.Context, client *http.Client, indexURL string, maxFiles int) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, indexURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eia company imports index status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return parseEIACompanyImportLinks(indexURL, string(body), maxFiles)
}

func parseEIACompanyImportLinks(indexURL, html string, maxFiles int) ([]string, error) {
	base, err := url.Parse(indexURL)
	if err != nil {
		return nil, err
	}
	re := regexp.MustCompile(`href="([^"]*/petroleum/imports/companylevel/archive/[^"]+\.xlsx)"`)
	matches := re.FindAllStringSubmatch(html, -1)
	seen := map[string]bool{}
	out := []string{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		ref, err := url.Parse(match[1])
		if err != nil {
			continue
		}
		resolved := base.ResolveReference(ref).String()
		if seen[resolved] {
			continue
		}
		seen[resolved] = true
		out = append(out, resolved)
		if maxFiles > 0 && len(out) >= maxFiles {
			break
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no EIA company import xlsx links found")
	}
	return out, nil
}

func fetchEIACompanyImportWorkbook(ctx context.Context, client *http.Client, sourceURL string) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eia company import workbook status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return body, nil
}

func parseEIACompanyImportWorkbook(r io.Reader) ([]EIACompanyImportRecord, error) {
	f, err := excelize.OpenReader(r)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rows, err := f.GetRows("IMPORTS")
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("IMPORTS sheet has no data rows")
	}
	headers := map[string]int{}
	for idx, raw := range rows[0] {
		headers[strings.ToUpper(strings.TrimSpace(raw))] = idx
	}
	required := []string{"RPT_PERIOD", "R_S_NAME", "PROD_CODE", "PROD_NAME", "PORT_CODE", "PORT_CITY", "PORT_STATE", "PORT_PADD", "GCTRY_CODE", "CNTRY_NAME", "QUANTITY"}
	for _, key := range required {
		if _, ok := headers[key]; !ok {
			return nil, fmt.Errorf("IMPORTS sheet missing %s", key)
		}
	}
	out := []EIACompanyImportRecord{}
	for i, row := range rows[1:] {
		month, err := parseEIACompanyImportMonth(eiaRowValue(row, headers, "RPT_PERIOD"))
		if err != nil {
			continue
		}
		importer := normalizeName(eiaRowValue(row, headers, "R_S_NAME"))
		if importer == "" {
			continue
		}
		quantity, ok := parseEIANumber(eiaRowValue(row, headers, "QUANTITY"))
		if !ok || quantity <= 0 {
			continue
		}
		productName := normalizeName(eiaRowValue(row, headers, "PROD_NAME"))
		originCountry := normalizeName(eiaRowValue(row, headers, "CNTRY_NAME"))
		raw := map[string]string{}
		for key, idx := range headers {
			if idx < len(row) {
				raw[key] = strings.TrimSpace(row[idx])
			}
		}
		rec := EIACompanyImportRecord{
			Month:          month,
			ImporterName:   importer,
			LineNumber:     eiaRowValue(row, headers, "LINE_NUM"),
			ProductCode:    strings.TrimSpace(eiaRowValue(row, headers, "PROD_CODE")),
			ProductName:    productName,
			ProductFamily:  eiaProductFamily(productName),
			PortCode:       strings.TrimSpace(eiaRowValue(row, headers, "PORT_CODE")),
			PortName:       normalizeName(eiaRowValue(row, headers, "PORT_CITY")),
			PortState:      strings.TrimSpace(eiaRowValue(row, headers, "PORT_STATE")),
			PortPADD:       strings.TrimSpace(eiaRowValue(row, headers, "PORT_PADD")),
			OriginCode:     strings.TrimSpace(eiaRowValue(row, headers, "GCTRY_CODE")),
			OriginCountry:  originCountry,
			OriginISO:      eiaCountryISO(originCountry),
			Quantity:       quantity,
			ProcessingName: normalizeName(eiaRowValue(row, headers, "PCOMP_RNAM")),
			Raw:            raw,
			RowNumber:      i + 2,
		}
		rec.Sulfur = parseOptionalEIANumber(eiaRowValue(row, headers, "SULFUR"))
		rec.APIGravity = parseOptionalEIANumber(eiaRowValue(row, headers, "APIGRAVITY"))
		out = append(out, rec)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("IMPORTS sheet contained no usable import rows")
	}
	return out, nil
}

func (s *Service) prepareEIACompanyImportRelease(ctx context.Context, sourceURL, checksum string, rowCount int64, records []EIACompanyImportRecord, force bool) (uuid.UUID, bool, error) {
	releaseVersion := eiaCompanyImportReleaseVersion(sourceURL, records)
	var existing uuid.UUID
	var status string
	err := s.pool.QueryRow(ctx, `
		SELECT id, import_status
		FROM data_source_releases
		WHERE source_key = $1 AND checksum = $2
	`, eiaCompanyImportsSourceKey, checksum).Scan(&existing, &status)
	if err == nil && status == "completed" && !force {
		return existing, true, nil
	}
	meta, _ := json.Marshal(map[string]any{
		"source_url":      sourceURL,
		"release_version": releaseVersion,
		"parser":          "eia_company_imports_v1",
	})
	var releaseID uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO data_source_releases (
			source_key, source_name, source_type, path, checksum, row_count, release_version,
			attribution, license, commercial_use_ok, import_status, imported_at, metadata
		)
		VALUES (
			$1, 'EIA Company Level Imports', 'xlsx', $2, $3, $4, $5,
			'Source: U.S. Energy Information Administration Form EIA-814 Company Level Imports',
			'U.S. Government public data / EIA open data', true, 'running', now(), $6
		)
		ON CONFLICT (source_key, checksum)
		DO UPDATE SET import_status='running', imported_at=now(), row_count=EXCLUDED.row_count,
			path=EXCLUDED.path, release_version=EXCLUDED.release_version, metadata=EXCLUDED.metadata,
			updated_at=now()
		RETURNING id
	`, eiaCompanyImportsSourceKey, sourceURL, checksum, rowCount, releaseVersion, meta).Scan(&releaseID)
	return releaseID, false, err
}

func (s *Service) persistEIACompanyImports(ctx context.Context, sourceURL string, releaseID uuid.UUID, records []EIACompanyImportRecord) (int, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	written := 0
	companyIDs := map[uuid.UUID]bool{}
	for _, rec := range records {
		companyID, err := upsertEIAImporterCompany(ctx, tx, rec)
		if err != nil {
			return written, len(companyIDs), err
		}
		if companyID != uuid.Nil {
			companyIDs[companyID] = true
		}
		raw, _ := json.Marshal(map[string]any{
			"source_url":       sourceURL,
			"source_row":       rec.RowNumber,
			"eia_origin_code":  rec.OriginCode,
			"eia_product_code": rec.ProductCode,
			"processing_name":  rec.ProcessingName,
			"raw":              rec.Raw,
		})
		sourceLineID := rec.LineNumber
		if sourceLineID == "" {
			sourceLineID = strconv.Itoa(rec.RowNumber)
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO trade_flow_facts (
				source_key,
				reporter_country_code,
				partner_country_code,
				product_code,
				flow_code,
				month,
				year,
				quantity,
				quantity_unit,
				value_usd,
				evidence_label,
				confidence_score,
				source_release_id,
				raw_payload,
				participant_company_id,
				participant_name,
				counterparty_name,
				port_code,
				port_name,
				port_state,
				port_padd,
				product_name,
				source_line_id,
				quality_api,
				quality_sulfur
			)
			VALUES (
				$1,'US',NULLIF($2,''),$3,'IMPORT',$4,$5,$6,'kbbl',NULL,
				'reported',0.90,$7,$8,$9,$10,NULL,$11,$12,$13,$14,$15,$16,$17,$18
			)
			ON CONFLICT (
				source_key, reporter_country_code, partner_country_code, product_code, flow_code,
				month, year, participant_name, port_code, source_line_id
			)
			DO UPDATE SET
				quantity = EXCLUDED.quantity,
				quantity_unit = EXCLUDED.quantity_unit,
				source_release_id = EXCLUDED.source_release_id,
				raw_payload = EXCLUDED.raw_payload,
				participant_company_id = EXCLUDED.participant_company_id,
				port_name = EXCLUDED.port_name,
				port_state = EXCLUDED.port_state,
				port_padd = EXCLUDED.port_padd,
				product_name = EXCLUDED.product_name,
				quality_api = EXCLUDED.quality_api,
				quality_sulfur = EXCLUDED.quality_sulfur
		`, eiaCompanyImportsSourceKey, rec.OriginISO, rec.ProductFamily, rec.Month, rec.Month.Year(), rec.Quantity,
			releaseID, raw, nullableUUID(companyID), rec.ImporterName, rec.PortCode, rec.PortName, rec.PortState,
			rec.PortPADD, rec.ProductName, sourceLineID, rec.APIGravity, rec.Sulfur)
		if err != nil {
			return written, len(companyIDs), err
		}
		written += int(tag.RowsAffected())
	}
	if err := markEIACompanyImportReleaseCompleted(ctx, tx, releaseID, written, len(companyIDs)); err != nil {
		return written, len(companyIDs), err
	}
	if err := tx.Commit(ctx); err != nil {
		return written, len(companyIDs), err
	}
	return written, len(companyIDs), nil
}

func upsertEIAImporterCompany(ctx context.Context, tx pgx.Tx, rec EIACompanyImportRecord) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT id
		FROM companies
		WHERE normalized_name = lower($1)
		  AND COALESCE(country_code, '') = 'US'
		ORDER BY confidence_score DESC NULLS LAST, updated_at DESC NULLS LAST
		LIMIT 1
	`, rec.ImporterName).Scan(&id)
	raw, _ := json.Marshal(map[string]any{
		"eia_company_imports_latest": map[string]any{
			"month":          formatMonth(rec.Month),
			"product_code":   rec.ProductFamily,
			"product_name":   rec.ProductName,
			"origin_country": rec.OriginCountry,
			"origin_iso":     rec.OriginISO,
			"port_code":      rec.PortCode,
			"port_name":      rec.PortName,
			"quantity_kbbl":  rec.Quantity,
		},
	})
	commodities := []string{rec.ProductFamily}
	if err == nil {
		_, err = tx.Exec(ctx, `
			UPDATE companies
			SET company_type = CASE
					WHEN COALESCE(company_type, '') = '' THEN 'buyer'
					WHEN company_type ILIKE '%buyer%' OR company_type ILIKE '%importer%' THEN company_type
					ELSE company_type || ',buyer'
				END,
				commodities = (
					SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(commodities, '{}'::text[]) || $2::text[]) AS x WHERE x <> '')
				),
				confidence_score = GREATEST(COALESCE(confidence_score, 0), 88),
				data_quality_status = 'reported',
				last_verified_at = now(),
				raw_source_payload = COALESCE(raw_source_payload, '{}'::jsonb) || $3::jsonb,
				updated_at = now()
			WHERE id = $1
		`, id, commodities, raw)
		return id, err
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO companies (
			name, normalized_name, country_code, company_type, commodities,
			confidence_score, data_quality_status, last_verified_at, raw_source_payload
		)
		VALUES ($1, lower($1), 'US', 'buyer', $2, 88, 'reported', now(), $3)
		RETURNING id
	`, rec.ImporterName, commodities, raw).Scan(&id)
	return id, err
}

func markEIACompanyImportReleaseCompleted(ctx context.Context, tx pgx.Tx, releaseID uuid.UUID, rowsWritten, companies int) error {
	meta, _ := json.Marshal(map[string]any{
		"rows_written": rowsWritten,
		"companies":    companies,
	})
	_, err := tx.Exec(ctx, `
		UPDATE data_source_releases
		SET import_status = 'completed',
			imported_at = now(),
			metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
			updated_at = now()
		WHERE id = $1
	`, releaseID, meta)
	return err
}

func parseEIACompanyImportMonth(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, fmt.Errorf("empty period")
	}
	for _, layout := range []string{"Jan-06", "Jan-2006", "2006-01"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported EIA period %q", raw)
}

func parseResultMonth(raw string) time.Time {
	t, _ := parseJODIMonth(raw)
	return t
}

func eiaRowValue(row []string, headers map[string]int, key string) string {
	idx, ok := headers[strings.ToUpper(key)]
	if !ok || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func parseEIANumber(raw string) (float64, bool) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if raw == "" || raw == "NA" || raw == "-" || raw == "--" || raw == "W" {
		return 0, false
	}
	v, err := strconv.ParseFloat(raw, 64)
	return v, err == nil
}

func parseOptionalEIANumber(raw string) *float64 {
	v, ok := parseEIANumber(raw)
	if !ok || v == 0 {
		return nil
	}
	return &v
}

func eiaProductFamily(productName string) string {
	p := strings.ToLower(productName)
	switch {
	case strings.Contains(p, "crude"):
		return "CRUDEOIL"
	case strings.Contains(p, "propane"), strings.Contains(p, "butane"), strings.Contains(p, "propylene"), strings.Contains(p, "butylene"):
		return "LPG"
	case strings.Contains(p, "natural gasoline"):
		return "NGL"
	case strings.Contains(p, "jet"):
		return "JETKERO"
	case strings.Contains(p, "distillate"), strings.Contains(p, "diesel"):
		return "GASDIES"
	case strings.Contains(p, "motor gas"), strings.Contains(p, "gasoline"), strings.Contains(p, "blendstock"), strings.Contains(p, "aviation gasoline"):
		return "GASOLINE"
	case strings.Contains(p, "naphtha"):
		return "NAPHTHA"
	case strings.Contains(p, "kerosene"):
		return "KEROSENE"
	case strings.Contains(p, "residual fuel"):
		return "RESFUEL"
	default:
		return "ONONSPEC"
	}
}

func eiaCompanyImportReleaseVersion(sourceURL string, records []EIACompanyImportRecord) string {
	latest := time.Time{}
	for _, rec := range records {
		if rec.Month.After(latest) {
			latest = rec.Month
		}
	}
	if !latest.IsZero() {
		return formatMonth(latest)
	}
	if u, err := url.Parse(sourceURL); err == nil {
		return strings.TrimSuffix(path.Base(u.Path), path.Ext(u.Path))
	}
	return ""
}

func eiaCountryISO(country string) string {
	key := strings.ToUpper(strings.TrimSpace(country))
	replacer := strings.NewReplacer(".", "", ", THE", "", "'", "")
	key = replacer.Replace(key)
	if v, ok := map[string]string{
		"ALGERIA":                    "DZ",
		"ANGOLA":                     "AO",
		"ARGENTINA":                  "AR",
		"BAHAMAS":                    "BS",
		"BAHRAIN":                    "BH",
		"BELGIUM":                    "BE",
		"BRAZIL":                     "BR",
		"CANADA":                     "CA",
		"CHILE":                      "CL",
		"CHINA":                      "CN",
		"COLOMBIA":                   "CO",
		"CONGO (KINSHASA)":           "CD",
		"COTE DIVOIRE (IVORY COAST)": "CI",
		"DENMARK":                    "DK",
		"ECUADOR":                    "EC",
		"EQUATORIAL GUINEA":          "GQ",
		"FRANCE":                     "FR",
		"GABON":                      "GA",
		"GERMANY":                    "DE",
		"GHANA":                      "GH",
		"GUYANA":                     "GY",
		"INDIA":                      "IN",
		"IRAQ":                       "IQ",
		"IRELAND":                    "IE",
		"ITALY":                      "IT",
		"JAPAN":                      "JP",
		"KOREA, SOUTH":               "KR",
		"KUWAIT":                     "KW",
		"LIBYA":                      "LY",
		"LITHUANIA":                  "LT",
		"MALAYSIA":                   "MY",
		"MEXICO":                     "MX",
		"NETHERLANDS":                "NL",
		"NIGERIA":                    "NG",
		"NORWAY":                     "NO",
		"PERU":                       "PE",
		"PORTUGAL":                   "PT",
		"QATAR":                      "QA",
		"SAUDI ARABIA":               "SA",
		"SENEGAL":                    "SN",
		"SPAIN":                      "ES",
		"SWEDEN":                     "SE",
		"SWITZERLAND":                "CH",
		"TAIWAN":                     "TW",
		"TRINIDAD AND TOBAGO":        "TT",
		"TURKEY":                     "TR",
		"TURKIYE":                    "TR",
		"UNITED ARAB EMIRATES":       "AE",
		"UNITED KINGDOM":             "GB",
		"VENEZUELA":                  "VE",
		"VIRGIN ISLANDS":             "VI",
		"VIRGIN ISLANDS (US)":        "VI",
	}[key]; ok {
		return v
	}
	parts := strings.FieldsFunc(key, func(r rune) bool { return r == ' ' || r == '-' || r == '_' || r == '(' || r == ')' })
	sort.Strings(parts)
	return strings.Join(parts, "_")
}
