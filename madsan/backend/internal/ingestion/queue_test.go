package ingestion

import "testing"

func TestErrJobAlreadyQueued(t *testing.T) {
	if ErrJobAlreadyQueued.Error() == "" {
		t.Fatal("expected message")
	}
}
