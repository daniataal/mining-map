package models

import (
	"time"
)

type EntityContact struct {
	ID              string     `json:"id"`
	EntityKind      string     `json:"entityKind"`
	EntityID        string     `json:"entityId"`
	ContactType     string     `json:"contactType"`
	ContactScope    string     `json:"contactScope"`
	Label           *string    `json:"label"`
	Value           string     `json:"value"`
	SourceName      *string    `json:"sourceName"`
	SourceURL       *string    `json:"sourceUrl"`
	SourceType      *string    `json:"sourceType"`
	ConfidenceScore *float64   `json:"confidenceScore"`
	RawPayload      any        `json:"rawPayload"`
	ExtractedFrom   *string    `json:"extractedFrom"`
	DiscoveredBy    *string    `json:"discoveredBy"`
	PhoneVerifiedAt *time.Time `json:"phoneVerifiedAt"`
	VerifiedAt      *time.Time `json:"verifiedAt"`
	LastSeenAt      *time.Time `json:"lastSeenAt"`
}

type EntityRelationship struct {
	ID                string     `json:"id"`
	SourceEntityKind  *string    `json:"sourceEntityKind"`
	SourceEntityRef   *string    `json:"sourceEntityRef"`
	TargetEntityKind  *string    `json:"targetEntityKind"`
	TargetEntityRef   *string    `json:"targetEntityRef"`
	TargetName        *string    `json:"targetName"`
	RelationshipType  *string    `json:"relationshipType"`
	RelationshipLabel *string    `json:"relationshipLabel"`
	OwnershipPct      *float64   `json:"ownershipPct"`
	EffectiveDate     *time.Time `json:"effectiveDate"`
	SourceName        *string    `json:"sourceName"`
	SourceURL         *string    `json:"sourceUrl"`
	SourceType        *string    `json:"sourceType"`
	ConfidenceScore   *float64   `json:"confidenceScore"`
	RawPayload        any        `json:"rawPayload"`
	ExtractedFrom     *string    `json:"extractedFrom"`
	VerifiedAt        *time.Time `json:"verifiedAt"`
	LastSeenAt        *time.Time `json:"lastSeenAt"`
}

type LegalEvent struct {
	ID              string     `json:"id"`
	Fingerprint     string     `json:"fingerprint"`
	EntityKind      string     `json:"entityKind"`
	EntityID        string     `json:"entityId"`
	CaseTitle       *string    `json:"caseTitle"`
	Parties         *string    `json:"parties"`
	Role            *string    `json:"role"`
	Court           *string    `json:"court"`
	Jurisdiction    *string    `json:"jurisdiction"`
	FiledDate       *time.Time `json:"filedDate"`
	Status          *string    `json:"status"`
	Summary         *string    `json:"summary"`
	SourceName      *string    `json:"sourceName"`
	SourceURL       *string    `json:"sourceUrl"`
	SourceType      *string    `json:"sourceType"`
	DiscoveredBy    *string    `json:"discoveredBy"`
	ConfidenceScore *float64   `json:"confidenceScore"`
	LastSeenAt      *time.Time `json:"lastSeenAt"`
	CreatedAt       *time.Time `json:"createdAt"`
}

type DDContact struct {
	ContactType       *string  `json:"contactType"`
	Value             *string  `json:"value"`
	Label             *string  `json:"label"`
	ContactScope      *string  `json:"contactScope"`
	ContactRole       *string  `json:"contactRole"`
	SourceName        *string  `json:"sourceName"`
	SourceURL         *string  `json:"sourceUrl"`
	EvidenceSnippet   *string  `json:"evidenceSnippet"`
	ExtractedFrom     *string  `json:"extractedFrom"`
	SourceBasis       *string  `json:"sourceBasis"`
	Confidence        *float64 `json:"confidence"`
	VerifiedAt        *string  `json:"verifiedAt"`
	AutoPromoted      *bool    `json:"autoPromoted"`
	PromotedContactID *string  `json:"promotedContactId"`
}

type DDReport struct {
	ID                     string      `json:"id"`
	EntityKind             string      `json:"entityKind"`
	EntityID               string      `json:"entityId"`
	Status                 *string     `json:"status"`
	Provider               *string     `json:"provider"`
	Model                  *string     `json:"model"`
	ExtractionProvider     *string     `json:"extractionProvider"`
	ExtractionModel        *string     `json:"extractionModel"`
	LegalProvider          *string     `json:"legalProvider"`
	LegalModel             *string     `json:"legalModel"`
	PhoneDiscoveryProvider *string     `json:"phoneDiscoveryProvider"`
	PhoneDiscoveryModel    *string     `json:"phoneDiscoveryModel"`
	PromptVersion          *string     `json:"promptVersion"`
	Analysis               *string     `json:"analysis"`
	SourceSummary          any         `json:"sourceSummary"`
	ExtractedContacts      []DDContact `json:"extractedContacts"`
	PromotedContacts       any         `json:"promotedContacts"`
	LegalEvents            any         `json:"legalEvents"`
	DiscoveredPhones       any         `json:"discoveredPhones"`
	CreatedAt              *time.Time  `json:"createdAt"`
}

type GovProcurementResponse struct {
	Source           *string  `json:"source"`
	SourceURL        *string  `json:"sourceUrl"`
	Scope            *string  `json:"scope"`
	Limitations      []string `json:"limitations"`
	Warnings         []string `json:"warnings"`
	QueriedAt        *string  `json:"queriedAt"`
	QueryCompany     *string  `json:"queryCompany"`
	DataOrigin       *string  `json:"dataOrigin"`
	LastSyncedAt     *string  `json:"lastSyncedAt"`
	RecipientProfile any      `json:"recipientProfile"`
	Awards           []any    `json:"awards"`
	Portfolio        any      `json:"portfolio"`
}

type TradeFlowsResponse struct {
	EntityName   string    `json:"entityName"`
	Country      string    `json:"country"`
	Flows        []any     `json:"flows"`
	Source       string    `json:"source"`
	LastSyncedAt time.Time `json:"lastSyncedAt"`
}

type EUProcurementResponse struct {
	Source           *string  `json:"source"`
	SourceURL        *string  `json:"sourceUrl"`
	Scope            *string  `json:"scope"`
	Limitations      []string `json:"limitations"`
	Warnings         []string `json:"warnings"`
	QueriedAt        *string  `json:"queriedAt"`
	QueryCompany     *string  `json:"queryCompany"`
	DataOrigin       *string  `json:"dataOrigin"`
	LastSyncedAt     *string  `json:"lastSyncedAt"`
	RecipientProfile any      `json:"recipientProfile"`
	Notices          []any    `json:"notices"`
	Portfolio        any      `json:"portfolio"`
}
