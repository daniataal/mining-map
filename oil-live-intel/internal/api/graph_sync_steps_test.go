package api

import (
	"context"
	"testing"
)

func TestQueryGraphSyncStepsNilPool(t *testing.T) {
	if got := queryGraphSyncSteps(context.Background(), nil); got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
}
