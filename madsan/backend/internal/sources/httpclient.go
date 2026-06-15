package sources

import (
	"net"
	"net/http"
	"time"
)

const DefaultHTTPTimeout = 45 * time.Second

// HTTPClient returns a direct client for open-data adapters (no host proxy leakage in Docker).
func HTTPClient() *http.Client {
	return &http.Client{
		Timeout: DefaultHTTPTimeout,
		Transport: &http.Transport{
			Proxy: nil,
			DialContext: (&net.Dialer{
				Timeout:   10 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
		},
	}
}
