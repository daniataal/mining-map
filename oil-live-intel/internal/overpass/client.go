package overpass

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type Element struct {
	Type     string            `json:"type"`
	ID       int64             `json:"id"`
	Lat      *float64          `json:"lat,omitempty"`
	Lon      *float64          `json:"lon,omitempty"`
	Tags     map[string]string `json:"tags,omitempty"`
	Center   *Point            `json:"center,omitempty"`
	Geometry []Point           `json:"geometry,omitempty"`
}

type Point struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type Response struct {
	Elements []Element `json:"elements"`
}

type Client struct {
	HTTPClient *http.Client
	Mirrors    []string
}

func NewClient() *Client {
	mirrors := []string{
		os.Getenv("STORAGE_OVERPASS_URL"),
		os.Getenv("OVERPASS_URL"),
		"https://overpass.kumi.systems/api/interpreter",
	}
	if strings.ToLower(strings.TrimSpace(os.Getenv("OVERPASS_INCLUDE_DE_FALLBACK"))) == "true" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("OVERPASS_INCLUDE_DE_FALLBACK"))) == "1" ||
		strings.ToLower(strings.TrimSpace(os.Getenv("OVERPASS_INCLUDE_DE_FALLBACK"))) == "yes" {
		mirrors = append(mirrors, "https://overpass-api.de/api/interpreter")
	}

	var activeMirrors []string
	seen := make(map[string]bool)
	for _, m := range mirrors {
		m = strings.TrimSpace(m)
		if m != "" && !seen[m] {
			activeMirrors = append(activeMirrors, m)
			seen[m] = true
		}
	}

	return &Client{
		HTTPClient: &http.Client{Timeout: 120 * time.Second},
		Mirrors:    activeMirrors,
	}
}

func (c *Client) Fetch(ctx context.Context, query string) ([]Element, error) {
	body := url.Values{}
	body.Set("data", query)
	encodedBody := body.Encode()

	var errs []string
	for _, mirror := range c.Mirrors {
		for attempt := 0; attempt < 3; attempt++ {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, mirror, strings.NewReader(encodedBody))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
			req.Header.Set("User-Agent", "MeridianMiningMap/1.0 (petroleum-osm; +https://github.com/)")

			resp, err := c.HTTPClient.Do(req)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s#%d: %v", mirror, attempt+1, err))
				time.Sleep(time.Duration(attempt+1) * 4 * time.Second)
				continue
			}

			if resp.StatusCode != http.StatusOK {
				bodyBytes, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				errs = append(errs, fmt.Sprintf("%s#%d: HTTP %d: %s", mirror, attempt+1, resp.StatusCode, string(bodyBytes)))
				time.Sleep(time.Duration(attempt+1) * 4 * time.Second)
				continue
			}

			var result Response
			if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
				resp.Body.Close()
				errs = append(errs, fmt.Sprintf("%s#%d: JSON decode: %v", mirror, attempt+1, err))
				time.Sleep(time.Duration(attempt+1) * 4 * time.Second)
				continue
			}
			resp.Body.Close()
			return result.Elements, nil
		}
	}
	return nil, fmt.Errorf("all overpass mirrors failed: %s", strings.Join(errs, "; "))
}

func BuildQuery(layerID string, bbox []float64) string {
	south, west, north, east := bbox[0], bbox[1], bbox[2], bbox[3]
	bboxText := fmt.Sprintf("%f,%f,%f,%f", south, west, north, east)

	if layerID == "storage_terminals" {
		petroleumSubstance := "^(oil|petroleum|diesel|gasoline|fuel|crude|lng|lpg|jet|kerosene|naphtha|refined)"
		return fmt.Sprintf(`[out:json][timeout:90];
(
  nwr["industrial"="petroleum_terminal"](%s);
  nwr["industrial"="tank_farm"](%s);
  nwr["industrial"="fuel"](%s);
  nwr["industrial"~"^(oil|gas)$"]["name"~"(terminal|tank\\s*farm|tankfarm|depot|storage)",i](%s);
  nwr["man_made"="storage_tank"]["substance"~"%s",i](%s);
  nwr["man_made"="storage_tank"]["product"~"%s",i](%s);
  nwr["man_made"="storage_tank"]["content"~"%s",i](%s);
  nwr["man_made"="silo"]["substance"~"%s",i](%s);
  nwr["man_made"="silo"]["product"~"%s",i](%s);
);
out center tags qt;`,
			bboxText, bboxText, bboxText, bboxText,
			petroleumSubstance, bboxText,
			petroleumSubstance, bboxText,
			petroleumSubstance, bboxText,
			petroleumSubstance, bboxText,
			petroleumSubstance, bboxText)
	}

	filter := ""
	if layerID == "pipelines" {
		filter = `way["man_made"="pipeline"]`
	} else if layerID == "refineries" {
		filter = `nwr["industrial"="refinery"]`
	}

	return fmt.Sprintf(`[out:json][timeout:45];
(
  %s(%s);
);
out geom qt;`, filter, bboxText)
}
