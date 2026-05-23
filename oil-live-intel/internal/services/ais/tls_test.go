package ais

import (
	"errors"
	"fmt"
	"testing"
)

func TestIsCertificateExpiredError(t *testing.T) {
	base := errors.New("dial tcp: certificate has expired")
	wrapped := fmt.Errorf("aisstream connect: %w", base)
	if !IsCertificateExpiredError(wrapped) {
		t.Fatal("expected wrapped expiry error")
	}
	if IsCertificateExpiredError(errors.New("connection reset")) {
		t.Fatal("unexpected match for unrelated error")
	}
}
