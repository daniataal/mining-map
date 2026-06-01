package models

import (
	"time"
)

type License struct {
	ID                string     `json:"id"`
	Company           string     `json:"company"`
	LicenseType       *string    `json:"licenseType"`
	Commodity         *string    `json:"commodity"`
	Status            *string    `json:"status"`
	DateIssued        *time.Time `json:"date"`
	Country           *string    `json:"country"`
	Region            *string    `json:"region"`
	Sector            *string    `json:"sector"`
	Lat               *float64   `json:"lat"`
	Lng               *float64   `json:"lng"`
	PhoneNumber       *string    `json:"phoneNumber"`
	ContactPerson     *string    `json:"contactPerson"`
	RecordOrigin      *string    `json:"record_origin"`
	SourceID          *string    `json:"source_id"`
	SourceName        *string    `json:"source_name"`
	SourceURL         *string    `json:"source_url"`
	SourceRecordURL   *string    `json:"source_record_url"`
	// source_updated_at is TEXT in production schema (Python ingest stores ISO strings).
	SourceUpdatedAt   *string    `json:"source_updated_at"`
	LastSyncedAt      *time.Time `json:"last_synced_at"`
	SourceKind        *string    `json:"source_kind"`
	EntityKind        *string    `json:"entityKind"`
	EntitySubtype     *string    `json:"entity_subtype"`
	ConfidenceScore   *float64   `json:"confidence_score"`
	ConfidenceNote    *string    `json:"confidence_note"`
	GeoSource         *string    `json:"geo_source"`
	GeoApproximated   *bool      `json:"geo_approximated"`
	GeoConfidence     *string    `json:"geo_confidence"`
	OriginalLat       *float64   `json:"original_lat"`
	OriginalLng       *float64   `json:"original_lng"`
	RawPayloadLite    *string    `json:"raw_payload_lite"`
}

type LicenseCreate struct {
	Company       string   `json:"company"`
	Country       string   `json:"country"`
	Region        *string  `json:"region"`
	Commodity     *string  `json:"commodity"`
	LicenseType   *string  `json:"licenseType"`
	Status        *string  `json:"status"`
	Lat           *float64 `json:"lat"`
	Lng           *float64 `json:"lng"`
	PhoneNumber   *string  `json:"phoneNumber"`
	ContactPerson *string  `json:"contactPerson"`
}

type LicenseUpdate struct {
	Company       *string  `json:"company"`
	Country       *string  `json:"country"`
	Region        *string  `json:"region"`
	Commodity     *string  `json:"commodity"`
	LicenseType   *string  `json:"licenseType"`
	Status        *string  `json:"status"`
	Lat           *float64 `json:"lat"`
	Lng           *float64 `json:"lng"`
	PhoneNumber   *string  `json:"phoneNumber"`
	ContactPerson *string  `json:"contactPerson"`
	PricePerKg    *float64 `json:"pricePerKg"`
	Capacity      *float64 `json:"capacity"`
}
