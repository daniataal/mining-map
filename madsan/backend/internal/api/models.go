package api

import "time"

type ConfidenceBlock struct {
	Score          float64    `json:"score"`
	Status         string     `json:"status"`
	LastVerifiedAt *time.Time `json:"last_verified_at,omitempty"`
}

type EvidenceClaim struct {
	SourceName      string  `json:"source_name"`
	ClaimType       string  `json:"claim_type"`
	ClaimValue      string  `json:"claim_value,omitempty"`
	ConfidenceScore float64 `json:"confidence_score"`
	Tier            string  `json:"tier,omitempty"`
}

type RelationshipEdge struct {
	ID              string   `json:"id"`
	Type            string   `json:"type"`
	EntityType      string   `json:"entity_type"`
	Name            string   `json:"name"`
	Direction       string   `json:"direction"`
	ConfidenceScore float64  `json:"confidence_score,omitempty"`
	Latitude        *float64 `json:"latitude,omitempty"`
	Longitude       *float64 `json:"longitude,omitempty"`
}

type EntitySignal struct {
	SignalType string  `json:"signal_type"`
	Label      string  `json:"label"`
	Score      float64 `json:"score,omitempty"`
	Tier       string  `json:"tier"`
	Detail     string  `json:"detail,omitempty"`
}

type STSScoreFactor struct {
	Name     string  `json:"name"`
	Weight   float64 `json:"weight"`
	Score    float64 `json:"score"`
	Weighted float64 `json:"weighted"`
	Detail   string  `json:"detail"`
}

type EntityEnvelope struct {
	ID            string     `json:"id"`
	EntityType    string     `json:"entity_type"`
	Confidence    float64    `json:"confidence"`
	Tier          string     `json:"tier"`
	EvidenceCount int        `json:"evidence_count"`
	ObservedAt    *time.Time `json:"observed_at,omitempty"`
	Limitations   []string   `json:"limitations,omitempty"`
}

type SignalHistoryEntry struct {
	SignalType       string           `json:"signal_type"`
	Label            string           `json:"label"`
	Tier             string           `json:"tier"`
	ConfidenceScore  float64          `json:"confidence_score"`
	OpportunityScore *float64         `json:"opportunity_score,omitempty"`
	ObservedAt       time.Time        `json:"observed_at"`
	Source           string           `json:"source,omitempty"`
	Detail           string           `json:"detail,omitempty"`
	STSFactors       []STSScoreFactor `json:"sts_factors,omitempty"`
}

type CoreEntityResponse struct {
	ID               string             `json:"id"`
	EntityType       string             `json:"entity_type"`
	Name             string             `json:"name"`
	Summary          map[string]any     `json:"summary"`
	Location         map[string]any     `json:"location,omitempty"`
	Confidence       ConfidenceBlock    `json:"confidence"`
	Evidence         []EvidenceClaim    `json:"evidence"`
	Signals          []EntitySignal        `json:"signals,omitempty"`
	SignalHistory    []SignalHistoryEntry  `json:"signal_history,omitempty"`
	OpportunityScore *float64              `json:"opportunity_score,omitempty"`
	Relationships    []RelationshipEdge `json:"relationships"`
	Limitations      []string           `json:"limitations,omitempty"`
	Envelope         EntityEnvelope     `json:"envelope,omitempty"`
}

type DealVerificationResult struct {
	DealID               string           `json:"deal_id"`
	ConfidenceScore      float64          `json:"confidence_score"`
	PositiveEvidence     []string         `json:"positive_evidence"`
	Warnings             []string         `json:"warnings"`
	MissingDocuments     []string         `json:"missing_documents"`
	RedFlags             []string         `json:"red_flags"`
	RecommendedQuestions []string         `json:"recommended_questions"`
	Entities             []CoreEntityResponse `json:"entities,omitempty"`
}

type SupplierSearchResult struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	CountryCode        string   `json:"country_code,omitempty"`
	Commodities        []string `json:"commodities"`
	ConfidenceScore    float64  `json:"confidence_score"`
	EvidenceCount      int      `json:"evidence_count"`
	ContactCount       int      `json:"contact_count,omitempty"`
	DataQualityStatus  string   `json:"data_quality_status,omitempty"`
	Tier               string   `json:"tier"`
	RankScore          float64  `json:"rank_score"`
	DistanceKm         *float64 `json:"distance_km,omitempty"`
}
