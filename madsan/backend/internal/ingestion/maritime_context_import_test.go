package ingestion

import "testing"

func TestParseMaritimeContextCSV(t *testing.T) {
	raw := "id,name,lat,lon,type,port_name,country_code,radius_m,confidence\nanc-1,Solent Anchorage,50.72,-1.28,anchorage,Southampton,GB,4500,80\n"
	records, err := parseMaritimeContextCSV(raw, "gfw_anchorages")
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	rec := records[0]
	if rec.SourceID != "anc-1" || rec.ContextType != "anchorage" || rec.PortName != "Southampton" {
		t.Fatalf("unexpected record: %+v", rec)
	}
	if rec.Lat == nil || rec.Lon == nil || *rec.Lat != 50.72 || *rec.Lon != -1.28 {
		t.Fatalf("expected coordinates, got lat=%v lon=%v", rec.Lat, rec.Lon)
	}
	if rec.Confidence != 0.8 {
		t.Fatalf("expected normalized confidence 0.8, got %v", rec.Confidence)
	}
}

func TestParseMaritimeContextGeoJSON(t *testing.T) {
	raw := []byte(`{
		"type":"FeatureCollection",
		"features":[{
			"type":"Feature",
			"properties":{"id":"gfw-1","name":"Fujairah Anchorage","context_type":"anchorage","port_group_id":"fujairah"},
			"geometry":{"type":"Point","coordinates":[56.42,25.18]}
		}]
	}`)
	records, err := parseMaritimeContextGeoJSON(raw, "gfw_anchorages")
	if err != nil {
		t.Fatalf("parse geojson: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	rec := records[0]
	if rec.SourceID != "gfw-1" || rec.Name != "Fujairah Anchorage" || rec.PortGroupID != "fujairah" {
		t.Fatalf("unexpected record: %+v", rec)
	}
	if rec.GeometryJSON == "" {
		t.Fatal("expected geometry json")
	}
}
