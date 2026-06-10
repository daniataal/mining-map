package portcall_test

import (
	"testing"

	"github.com/madsan/intelligence/internal/maritime/portcall"
)

func TestClassifyEventLoading(t *testing.T) {
	got := portcall.ClassifyEvent(10, 12, true)
	if got != portcall.EventPossibleLoading {
		t.Fatalf("got %q", got)
	}
}

func TestClassifyEventUnloading(t *testing.T) {
	got := portcall.ClassifyEvent(12, 9, true)
	if got != portcall.EventPossibleUnloading {
		t.Fatalf("got %q", got)
	}
}
