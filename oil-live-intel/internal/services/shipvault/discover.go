package shipvault

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const (
	defaultShipVaultAppURL = "https://app.shipvault.io"
	maxDiscoverBodyBytes   = 2 << 20 // 2 MiB per asset
	maxScriptFetches       = 8
)

// firebaseAPIKeyRE matches Firebase web client keys embedded in ShipVault bundles or URLs.
var firebaseAPIKeyRE = regexp.MustCompile(`(?i)(?:apiKey\s*[:=]\s*["']|["']apiKey["']\s*:\s*["']|key=)(AIza[0-9A-Za-z_-]{35})`)

// DiscoverFirebaseAPIKey loads the ShipVault web app HTML and linked JS once and extracts
// the public Firebase Web API key (same value visible in DevTools identitytoolkit URLs).
func DiscoverFirebaseAPIKey(ctx context.Context, appOrigin string, client *http.Client) (string, error) {
	appOrigin = strings.TrimRight(strings.TrimSpace(appOrigin), "/")
	if appOrigin == "" {
		appOrigin = defaultShipVaultAppURL
	}
	if client == nil {
		client = &http.Client{Timeout: httpTimeout}
	}

	html, err := fetchDiscoverText(ctx, client, appOrigin+"/")
	if err != nil {
		return "", fmt.Errorf("shipvault firebase key discovery: fetch app: %w", err)
	}
	if key := extractFirebaseAPIKey(html); key != "" {
		return key, nil
	}

	seen := map[string]struct{}{appOrigin + "/": {}}
	fetches := 0
	for _, src := range scriptSrcsFromHTML(html) {
		if fetches >= maxScriptFetches {
			break
		}
		abs, err := resolveDiscoverURL(appOrigin, src)
		if err != nil {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		fetches++

		js, err := fetchDiscoverText(ctx, client, abs)
		if err != nil {
			continue
		}
		if key := extractFirebaseAPIKey(js); key != "" {
			return key, nil
		}
	}

	return "", fmt.Errorf("shipvault firebase key discovery: apiKey not found in %s assets", appOrigin)
}

func extractFirebaseAPIKey(body string) string {
	m := firebaseAPIKeyRE.FindStringSubmatch(body)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

var scriptSrcRE = regexp.MustCompile(`(?i)<script[^>]+src=["']([^"']+)["']`)

func scriptSrcsFromHTML(html string) []string {
	matches := scriptSrcRE.FindAllStringSubmatch(html, -1)
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) >= 2 {
			out = append(out, m[1])
		}
	}
	return out
}

func resolveDiscoverURL(origin, ref string) (string, error) {
	base, err := url.Parse(origin + "/")
	if err != nil {
		return "", err
	}
	u, err := url.Parse(ref)
	if err != nil {
		return "", err
	}
	return base.ResolveReference(u).String(), nil
}

func fetchDiscoverText(ctx context.Context, client *http.Client, rawURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/html,application/javascript,*/*")
	req.Header.Set("User-Agent", "oil-live-intel/shipvault-discover")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s: status %d", rawURL, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiscoverBodyBytes))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// resolveFirebaseAPIKey returns an explicit env key or discovers it from the ShipVault web app.
func resolveFirebaseAPIKey(ctx context.Context, opts ServiceOptions, client *http.Client) (string, error) {
	if k := strings.TrimSpace(opts.FirebaseAPIKey); k != "" {
		return k, nil
	}
	origin := strings.TrimSpace(opts.AppOriginURL)
	if origin == "" {
		origin = defaultShipVaultAppURL
	}
	return DiscoverFirebaseAPIKey(ctx, origin, client)
}
