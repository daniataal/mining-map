package api

import (
	"net/http/httptest"
	"testing"
)

func TestBrokerJSONOrEmpty(t *testing.T) {
	if got := string(brokerJSONOrEmpty(nil)); got != "{}" {
		t.Fatalf("expected {}, got %s", got)
	}
	if got := string(brokerJSONOrEmpty([]byte(`{"a":1}`))); got != `{"a":1}` {
		t.Fatalf("unexpected %s", got)
	}
}

func TestBrokerUserIDFallback(t *testing.T) {
	r := httptest.NewRequest("GET", "/?user_id=alice", nil)
	if brokerUserID(r) != "alice" {
		t.Fatalf("expected alice")
	}
	r.Header.Set("X-User-Id", "bob")
	if brokerUserID(r) != "bob" {
		t.Fatalf("expected bob from header")
	}
}
