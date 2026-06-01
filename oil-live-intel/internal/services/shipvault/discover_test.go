package shipvault

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDiscoverFirebaseAPIKey_fromHTMLAndBundle(t *testing.T) {
	t.Parallel()

	const want = "AIzaSy000000000000000000000000000000001"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte(`<!doctype html><script src="/assets/main-abc.js"></script>`))
		case "/assets/main-abc.js":
			_, _ = w.Write([]byte(`const cfg={apiKey:"` + want + `",authDomain:"x.firebaseapp.com"};`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	got, err := DiscoverFirebaseAPIKey(context.Background(), srv.URL, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("DiscoverFirebaseAPIKey() = %q, want %q", got, want)
	}
}

func TestDiscoverFirebaseAPIKey_inlineInHTML(t *testing.T) {
	t.Parallel()

	const want = "AIzaSy000000000000000000000000000000002"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<script>window.__FIREBASE__={"apiKey":"` + want + `"}</script>`))
	}))
	defer srv.Close()

	got, err := DiscoverFirebaseAPIKey(context.Background(), srv.URL, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDiscoverFirebaseAPIKey_notFound(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>no firebase here</html>"))
	}))
	defer srv.Close()

	_, err := DiscoverFirebaseAPIKey(context.Background(), srv.URL, srv.Client())
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected not found error, got %v", err)
	}
}

func TestExtractFirebaseAPIKey_identityToolkitURL(t *testing.T) {
	t.Parallel()

	want := "AIzaSy000000000000000000000000000000003"
	body := `fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=` + want + `")`
	got := extractFirebaseAPIKey(body)
	if got != want {
		t.Fatalf("extractFirebaseAPIKey() = %q, want %q", got, want)
	}
}
