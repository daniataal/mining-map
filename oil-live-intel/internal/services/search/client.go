// Package search wraps the Elasticsearch client used by the indexer worker
// and the search HTTP handlers.
//
// The package intentionally exposes a minimal Client interface so the API
// handlers can be tested with a fake (no live ES required).
package search

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"
)

// Client is the minimal subset of the go-elasticsearch API the rest of the
// package depends on. Tests substitute a stub implementation.
type Client interface {
	Ping(ctx context.Context) error
	Search(ctx context.Context, index string, body any) (*SearchResponse, error)
	Bulk(ctx context.Context, body io.Reader) (*BulkResponse, error)
	IndexExists(ctx context.Context, index string) (bool, error)
	CreateIndex(ctx context.Context, index string, body any) error
	Count(ctx context.Context, index string) (int64, error)
}

// SearchResponse is a minimal representation of an Elasticsearch search hit
// payload, sufficient for our handler shape (id, score, source).
type SearchResponse struct {
	Took int `json:"took"`
	Hits struct {
		Total struct {
			Value int64 `json:"value"`
		} `json:"total"`
		Hits []struct {
			ID     string          `json:"_id"`
			Index  string          `json:"_index"`
			Score  float64         `json:"_score"`
			Source json.RawMessage `json:"_source"`
		} `json:"hits"`
	} `json:"hits"`
}

// BulkResponse is the trimmed subset of /_bulk response the indexer cares
// about — total errors and per-item error reasons.
type BulkResponse struct {
	Took   int  `json:"took"`
	Errors bool `json:"errors"`
	Items  []map[string]struct {
		ID     string `json:"_id"`
		Status int    `json:"status"`
		Error  *struct {
			Type   string `json:"type"`
			Reason string `json:"reason"`
		} `json:"error,omitempty"`
	} `json:"items"`
}

// realClient adapts *elasticsearch.Client to the Client interface used by
// the rest of the package.
type realClient struct {
	es *elasticsearch.Client
}

// NewClient returns a Client backed by a real *elasticsearch.Client. When url
// is empty or refers to an unreachable host, the returned Client will still
// satisfy the interface but every operation will fail at call time; callers
// handle that by surfacing "search_unavailable" to the UI.
func NewClient(url string) (Client, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, fmt.Errorf("ELASTICSEARCH_URL is empty")
	}
	cfg := elasticsearch.Config{
		Addresses: []string{url},
	}
	es, err := elasticsearch.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("new elasticsearch client: %w", err)
	}
	return &realClient{es: es}, nil
}

func (c *realClient) Ping(ctx context.Context) error {
	res, err := c.es.Ping(c.es.Ping.WithContext(ctx))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		return fmt.Errorf("ping returned %d", res.StatusCode)
	}
	return nil
}

func (c *realClient) IndexExists(ctx context.Context, index string) (bool, error) {
	res, err := c.es.Indices.Exists([]string{index}, c.es.Indices.Exists.WithContext(ctx))
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
		return true, nil
	case http.StatusNotFound:
		return false, nil
	default:
		return false, fmt.Errorf("indices.exists %s: %d", index, res.StatusCode)
	}
}

func (c *realClient) CreateIndex(ctx context.Context, index string, body any) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal create body: %w", err)
	}
	res, err := c.es.Indices.Create(
		index,
		c.es.Indices.Create.WithContext(ctx),
		c.es.Indices.Create.WithBody(bytes.NewReader(buf)),
	)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.IsError() {
		errBody, _ := io.ReadAll(res.Body)
		return fmt.Errorf("indices.create %s: %d %s", index, res.StatusCode, string(errBody))
	}
	return nil
}

func (c *realClient) Search(ctx context.Context, index string, body any) (*SearchResponse, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal search body: %w", err)
	}
	res, err := c.es.Search(
		c.es.Search.WithContext(ctx),
		c.es.Search.WithIndex(index),
		c.es.Search.WithBody(bytes.NewReader(buf)),
	)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		errBody, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("search %s: %d %s", index, res.StatusCode, string(errBody))
	}
	var out SearchResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode search response: %w", err)
	}
	return &out, nil
}

func (c *realClient) Bulk(ctx context.Context, body io.Reader) (*BulkResponse, error) {
	req := esapi.BulkRequest{Body: body}
	res, err := req.Do(ctx, c.es)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.IsError() {
		errBody, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("bulk: %d %s", res.StatusCode, string(errBody))
	}
	var out BulkResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode bulk response: %w", err)
	}
	return &out, nil
}

func (c *realClient) Count(ctx context.Context, index string) (int64, error) {
	res, err := c.es.Count(
		c.es.Count.WithContext(ctx),
		c.es.Count.WithIndex(index),
	)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.IsError() {
		return 0, fmt.Errorf("count %s: %d", index, res.StatusCode)
	}
	var body struct {
		Count int64 `json:"count"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return 0, fmt.Errorf("decode count response: %w", err)
	}
	return body.Count, nil
}

// PingWithTimeout is a convenience that bounds Ping with a short deadline.
// Useful for the /search/health endpoint and for the indexer's "wait for ES"
// loop on cold start.
func PingWithTimeout(parent context.Context, c Client, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	return c.Ping(ctx)
}
