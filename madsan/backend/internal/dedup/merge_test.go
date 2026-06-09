package dedup

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestMemberIDsFromPayload(t *testing.T) {
	a := uuid.New().String()
	b := uuid.New().String()
	raw, _ := json.Marshal(map[string]any{
		"members": []CompanyMember{{ID: a, Name: "Alpha"}, {ID: b, Name: "Beta"}},
	})
	ids, err := memberIDsFromPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0].String() != a {
		t.Fatalf("unexpected ids: %v", ids)
	}
}

func TestContainsUUID(t *testing.T) {
	id := uuid.New()
	if !containsUUID([]uuid.UUID{id}, id) {
		t.Fatal("expected contains")
	}
	if containsUUID([]uuid.UUID{uuid.New()}, id) {
		t.Fatal("expected not contains")
	}
}

func TestCanonicalID(t *testing.T) {
	high := 90.0
	low := 50.0
	cluster := CompanyCluster{
		Members: []CompanyMember{
			{ID: "low-id", ConfidenceScore: &low},
			{ID: "high-id", ConfidenceScore: &high},
		},
	}
	if CanonicalID(cluster) != "high-id" {
		t.Fatalf("expected high confidence id, got %s", CanonicalID(cluster))
	}
}
