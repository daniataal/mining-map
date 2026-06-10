package sources

import (
	"net/http"
	"time"
)

const DefaultHTTPTimeout = 45 * time.Second

// HTTPClient returns a client with a sensible timeout for open-data adapters.
func HTTPClient() *http.Client {
	return &http.Client{Timeout: DefaultHTTPTimeout}
}
