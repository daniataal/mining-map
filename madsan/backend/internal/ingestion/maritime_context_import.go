package ingestion

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type maritimeContextImportPayload struct {
	Path   string `json:"path"`
	Source string `json:"source"`
	DryRun bool   `json:"dry_run"`
}

type maritimeContextRecord struct {
	Source       string
	SourceID     string
	Name         string
	ContextType  string
	PortGroupID  string
	PortName     string
	CountryCode  string
	RadiusM      float64
	Confidence   float64
	Lat          *float64
	Lon          *float64
	GeometryJSON string
	Metadata     map[string]any
}

type geoJSONFeatureCollection struct {
	Type     string           `json:"type"`
	Features []geoJSONFeature `json:"features"`
}

type geoJSONFeature struct {
	Type       string          `json:"type"`
	Properties map[string]any  `json:"properties"`
	Geometry   json.RawMessage `json:"geometry"`
}

func (s *Service) processMaritimeContextImport(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	started := time.Now()
	var p maritimeContextImportPayload
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &p)
	}
	source := strings.TrimSpace(p.Source)
	if source == "" {
		source = "gfw_anchorages"
	}
	path, err := s.resolveMaritimeContextPath(p.Path)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	records, err := parseMaritimeContextRecords(filepath.Base(path), b, source)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	if p.DryRun {
		report, _ := json.Marshal(map[string]any{
			"source":      source,
			"path":        path,
			"records":     len(records),
			"dry_run":     true,
			"duration_ms": time.Since(started).Milliseconds(),
		})
		return s.finishIntelJob(ctx, jobID, "completed", report, nil)
	}

	imported := 0
	for _, rec := range records {
		if err := s.upsertMaritimeContext(ctx, rec); err != nil {
			return s.finishIntelJob(ctx, jobID, "failed", nil, err)
		}
		imported++
	}
	report, _ := json.Marshal(map[string]any{
		"source":      source,
		"path":        path,
		"records":     len(records),
		"imported":    imported,
		"duration_ms": time.Since(started).Milliseconds(),
	})
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) resolveMaritimeContextPath(requested string) (string, error) {
	candidates := []string{}
	if requested = strings.TrimSpace(requested); requested != "" {
		candidates = append(candidates, requested)
		if !filepath.IsAbs(requested) {
			candidates = append(candidates, filepath.Join(s.cfg.RawDataDir, requested))
			candidates = append(candidates, filepath.Join("..", requested))
		}
	}
	candidates = append(candidates,
		filepath.Join(s.cfg.RawDataDir, "gfw_anchorages.geojson"),
		filepath.Join(s.cfg.RawDataDir, "gfw_anchorages.csv"),
		filepath.Join(s.cfg.RawDataDir, "gfw", "anchorages.geojson"),
		filepath.Join(s.cfg.RawDataDir, "gfw", "anchorages.csv"),
		filepath.Join("..", "data", "gfw", "anchorages.geojson"),
		filepath.Join("..", "data", "gfw", "anchorages.csv"),
	)
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			if ap, err := filepath.Abs(candidate); err == nil {
				return ap, nil
			}
			return candidate, nil
		}
	}
	return "", fmt.Errorf("no maritime context file found; provide payload.path or place gfw_anchorages.geojson/csv under %s", s.cfg.RawDataDir)
}

func parseMaritimeContextRecords(name string, b []byte, source string) ([]maritimeContextRecord, error) {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".csv":
		return parseMaritimeContextCSV(string(b), source)
	case ".json", ".geojson":
		return parseMaritimeContextGeoJSON(b, source)
	default:
		return nil, fmt.Errorf("unsupported maritime context file extension: %s", filepath.Ext(name))
	}
}

func parseMaritimeContextCSV(raw string, source string) ([]maritimeContextRecord, error) {
	r := csv.NewReader(strings.NewReader(raw))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, nil
	}
	headers := maritimeHeaderIndex(rows[0])
	out := make([]maritimeContextRecord, 0, len(rows)-1)
	for _, row := range rows[1:] {
		lat, okLat := parseContextFloat(firstContextValue(row, headers, "lat", "latitude", "y"))
		lon, okLon := parseContextFloat(firstContextValue(row, headers, "lon", "lng", "longitude", "x"))
		if !okLat || !okLon {
			continue
		}
		rec := baseMaritimeContextRecord(source, map[string]any{"raw_row": row})
		rec.Lat = &lat
		rec.Lon = &lon
		rec.SourceID = firstContextValue(row, headers, "source_id", "id", "anchorage_id", "port_id", "gfw_id", "s2id")
		rec.Name = firstContextValue(row, headers, "name", "label", "anchorage_name", "port_name")
		rec.ContextType = firstContextValue(row, headers, "context_type", "type", "kind", "zone_type")
		rec.PortGroupID = firstContextValue(row, headers, "port_group_id", "port_group", "port_id")
		rec.PortName = firstContextValue(row, headers, "port_name", "port", "parent_port")
		rec.CountryCode = firstContextValue(row, headers, "country_code", "iso3", "iso2", "country")
		if v, ok := parseContextFloat(firstContextValue(row, headers, "radius_m", "radius", "buffer_m")); ok && v > 0 {
			rec.RadiusM = v
		}
		if v, ok := parseContextFloat(firstContextValue(row, headers, "confidence", "confidence_score")); ok && v > 0 {
			rec.Confidence = normalizeConfidence(v)
		}
		rec.clean()
		out = append(out, rec)
	}
	return out, nil
}

func parseMaritimeContextGeoJSON(b []byte, source string) ([]maritimeContextRecord, error) {
	var fc geoJSONFeatureCollection
	if err := json.Unmarshal(b, &fc); err != nil {
		return nil, err
	}
	features := fc.Features
	if strings.EqualFold(fc.Type, "Feature") {
		var f geoJSONFeature
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		features = []geoJSONFeature{f}
	}
	out := make([]maritimeContextRecord, 0, len(features))
	for _, f := range features {
		if len(f.Geometry) == 0 || string(f.Geometry) == "null" {
			continue
		}
		props := f.Properties
		if props == nil {
			props = map[string]any{}
		}
		rec := baseMaritimeContextRecord(source, props)
		rec.GeometryJSON = string(f.Geometry)
		rec.SourceID = firstProp(props, "source_id", "id", "anchorage_id", "port_id", "gfw_id", "s2id")
		rec.Name = firstProp(props, "name", "label", "anchorage_name", "port_name")
		rec.ContextType = firstProp(props, "context_type", "type", "kind", "zone_type")
		rec.PortGroupID = firstProp(props, "port_group_id", "port_group", "port_id")
		rec.PortName = firstProp(props, "port_name", "port", "parent_port")
		rec.CountryCode = firstProp(props, "country_code", "iso3", "iso2", "country")
		if v, ok := parseContextFloat(firstProp(props, "radius_m", "radius", "buffer_m")); ok && v > 0 {
			rec.RadiusM = v
		}
		if v, ok := parseContextFloat(firstProp(props, "confidence", "confidence_score")); ok && v > 0 {
			rec.Confidence = normalizeConfidence(v)
		}
		rec.clean()
		out = append(out, rec)
	}
	return out, nil
}

func baseMaritimeContextRecord(source string, metadata map[string]any) maritimeContextRecord {
	return maritimeContextRecord{
		Source:      source,
		ContextType: "anchorage",
		RadiusM:     3000,
		Confidence:  0.75,
		Metadata:    metadata,
	}
}

func (r *maritimeContextRecord) clean() {
	r.Source = strings.TrimSpace(r.Source)
	if r.Source == "" {
		r.Source = "gfw_anchorages"
	}
	r.SourceID = strings.TrimSpace(r.SourceID)
	r.Name = strings.TrimSpace(r.Name)
	r.ContextType = strings.ToLower(strings.TrimSpace(r.ContextType))
	if r.ContextType == "" {
		r.ContextType = "anchorage"
	}
	r.PortGroupID = strings.TrimSpace(r.PortGroupID)
	r.PortName = strings.TrimSpace(r.PortName)
	r.CountryCode = strings.ToUpper(strings.TrimSpace(r.CountryCode))
	if r.SourceID == "" {
		sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%v|%v", r.Source, r.Name, r.GeometryJSON, r.Lat, r.Lon)))
		r.SourceID = hex.EncodeToString(sum[:12])
	}
}

func (s *Service) upsertMaritimeContext(ctx context.Context, rec maritimeContextRecord) error {
	metadata, _ := json.Marshal(rec.Metadata)
	if rec.GeometryJSON != "" {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO maritime_context_zones (
				source, source_id, name, context_type, port_group_id, port_name, country_code,
				radius_m, confidence, geom, metadata, updated_at
			)
			VALUES (
				$1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
				$8, $9, ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)::geography, $11::jsonb, now()
			)
			ON CONFLICT (source, source_id) DO UPDATE SET
				name = EXCLUDED.name,
				context_type = EXCLUDED.context_type,
				port_group_id = EXCLUDED.port_group_id,
				port_name = EXCLUDED.port_name,
				country_code = EXCLUDED.country_code,
				radius_m = EXCLUDED.radius_m,
				confidence = EXCLUDED.confidence,
				geom = EXCLUDED.geom,
				metadata = EXCLUDED.metadata,
				updated_at = now()
		`, rec.Source, rec.SourceID, rec.Name, rec.ContextType, rec.PortGroupID, rec.PortName, rec.CountryCode, rec.RadiusM, rec.Confidence, rec.GeometryJSON, metadata)
		return err
	}
	if rec.Lat == nil || rec.Lon == nil {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO maritime_context_zones (
			source, source_id, name, context_type, port_group_id, port_name, country_code,
			radius_m, confidence, geom, metadata, updated_at
		)
		VALUES (
			$1, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
			$8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography, $12::jsonb, now()
		)
		ON CONFLICT (source, source_id) DO UPDATE SET
			name = EXCLUDED.name,
			context_type = EXCLUDED.context_type,
			port_group_id = EXCLUDED.port_group_id,
			port_name = EXCLUDED.port_name,
			country_code = EXCLUDED.country_code,
			radius_m = EXCLUDED.radius_m,
			confidence = EXCLUDED.confidence,
			geom = EXCLUDED.geom,
			metadata = EXCLUDED.metadata,
			updated_at = now()
	`, rec.Source, rec.SourceID, rec.Name, rec.ContextType, rec.PortGroupID, rec.PortName, rec.CountryCode, rec.RadiusM, rec.Confidence, *rec.Lon, *rec.Lat, metadata)
	return err
}

func maritimeHeaderIndex(headers []string) map[string]int {
	out := map[string]int{}
	for i, h := range headers {
		out[normalizeContextKey(h)] = i
	}
	return out
}

func firstContextValue(row []string, headers map[string]int, keys ...string) string {
	for _, key := range keys {
		idx, ok := headers[normalizeContextKey(key)]
		if !ok || idx < 0 || idx >= len(row) {
			continue
		}
		if v := strings.TrimSpace(row[idx]); v != "" {
			return v
		}
	}
	return ""
}

func firstProp(props map[string]any, keys ...string) string {
	if len(props) == 0 {
		return ""
	}
	norm := map[string]any{}
	for k, v := range props {
		norm[normalizeContextKey(k)] = v
	}
	for _, key := range keys {
		if v, ok := norm[normalizeContextKey(key)]; ok {
			if s := strings.TrimSpace(fmt.Sprintf("%v", v)); s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
}

func normalizeContextKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "-", "_")
	key = strings.ReplaceAll(key, " ", "_")
	return key
}

func parseContextFloat(raw string) (float64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	v, err := strconv.ParseFloat(raw, 64)
	return v, err == nil
}

func normalizeConfidence(v float64) float64 {
	if v > 1 {
		v = v / 100
	}
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
