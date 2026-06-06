package cache

import (
	"context"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

const keyPrefix = "oil-intel:resp:"

// Entry holds a cached HTTP response body and metadata.
type Entry struct {
	StatusCode   int
	Body         []byte
	CacheControl string
}

// Cache is an optional Redis-backed response cache (fail-open when disabled or down).
type Cache struct {
	client  *redis.Client
	enabled bool
	log     zerolog.Logger
}

// New creates a Cache from an optional Redis URL. Empty URL disables caching.
func New(redisURL string, log zerolog.Logger) *Cache {
	c := &Cache{log: log}
	redisURL = strings.TrimSpace(redisURL)
	if redisURL == "" {
		return c
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Warn().Err(err).Msg("redis cache: invalid URL; caching disabled")
		return c
	}
	opts.ReadTimeout = 500 * time.Millisecond
	opts.WriteTimeout = 500 * time.Millisecond
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		log.Warn().Err(err).Msg("redis cache: ping failed; caching disabled")
		_ = client.Close()
		return c
	}
	c.client = client
	c.enabled = true
	log.Info().Msg("redis cache: enabled")
	return c
}

// Enabled reports whether Redis caching is active.
func (c *Cache) Enabled() bool {
	return c != nil && c.enabled && c.client != nil
}

// Close releases the Redis client.
func (c *Cache) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

// BuildKey returns method + path + sorted query string for cache lookup.
func BuildKey(method, path string, query url.Values) string {
	pairs := make([]string, 0, len(query))
	for k, vals := range query {
		for _, v := range vals {
			pairs = append(pairs, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	sort.Strings(pairs)
	qs := strings.Join(pairs, "&")
	if qs != "" {
		return strings.ToUpper(method) + " " + path + "?" + qs
	}
	return strings.ToUpper(method) + " " + path
}

// TTLForPath returns cache TTL for hot read paths, or 0 when uncached.
func TTLForPath(path string) time.Duration {
	switch {
	case path == "/api/oil-live/maritime/stats":
		return 30 * time.Second
	case path == "/api/oil-live/licenses/country-summary",
		path == "/api/oil-live/map/country-borders",
		path == "/api/oil-live/sanctions/country-summary":
		return 120 * time.Second
	case strings.HasPrefix(path, "/api/oil-live/intelligence/country/"):
		return 120 * time.Second
	default:
		return 0
	}
}

func (c *Cache) redisKey(key string) string {
	return keyPrefix + key
}

// Get returns a cached entry. Errors and misses return nil (fail-open).
func (c *Cache) Get(ctx context.Context, key string) *Entry {
	if !c.Enabled() {
		return nil
	}
	data, err := c.client.Get(ctx, c.redisKey(key)).Bytes()
	if err != nil {
		return nil
	}
	var e Entry
	if err := decodeEntry(data, &e); err != nil {
		c.log.Debug().Err(err).Str("key", key).Msg("redis cache: decode failed")
		return nil
	}
	return &e
}

// Set stores a response entry with TTL. Errors are logged and ignored (fail-open).
func (c *Cache) Set(ctx context.Context, key string, e Entry, ttl time.Duration) {
	if !c.Enabled() || ttl <= 0 {
		return
	}
	data, err := encodeEntry(e)
	if err != nil {
		c.log.Debug().Err(err).Str("key", key).Msg("redis cache: encode failed")
		return
	}
	if err := c.client.Set(ctx, c.redisKey(key), data, ttl).Err(); err != nil {
		c.log.Debug().Err(err).Str("key", key).Msg("redis cache: set failed")
	}
}

// Middleware caches idempotent GET responses for configured hot paths.
func (c *Cache) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !c.Enabled() {
			next.ServeHTTP(w, r)
			return
		}
		ttl := TTLForPath(r.URL.Path)
		if ttl <= 0 {
			next.ServeHTTP(w, r)
			return
		}
		key := BuildKey(r.Method, r.URL.Path, r.URL.Query())
		if hit := c.Get(r.Context(), key); hit != nil {
			w.Header().Set("Content-Type", "application/json")
			if hit.CacheControl != "" {
				w.Header().Set("Cache-Control", hit.CacheControl)
			}
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(hit.StatusCode)
			_, _ = w.Write(hit.Body)
			return
		}

		rec := &responseRecorder{ResponseWriter: w, status: http.StatusOK, header: make(http.Header)}
		next.ServeHTTP(rec, r)
		if rec.status != http.StatusOK || len(rec.body) == 0 {
			return
		}
		cc := rec.header.Get("Cache-Control")
		c.Set(r.Context(), key, Entry{
			StatusCode:   rec.status,
			Body:         append([]byte(nil), rec.body...),
			CacheControl: cc,
		}, ttl)
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	body   []byte
	header http.Header
}

func (r *responseRecorder) Header() http.Header {
	return r.header
}

func (r *responseRecorder) WriteHeader(code int) {
	r.status = code
	for k, vals := range r.header {
		for _, v := range vals {
			r.ResponseWriter.Header().Add(k, v)
		}
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body = append(r.body, b...)
	return r.ResponseWriter.Write(b)
}
