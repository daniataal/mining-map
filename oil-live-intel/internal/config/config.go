package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                    string
	DatabaseURL             string
	AISStreamAPIKey         string
	EIAAPIKey               string
	ComtradeAPIKey          string
	EnableAIS               bool
	EnableEIA               bool
	EnableComtrade          bool
	EnableOSMImport         bool
	ExistingBackendURL      string
	SupplierCreateEndpoint  string
	SeedOnStartup           bool
	APIBaseURL              string
	InternalBroadcastKey    string
	AISPositionRetainHours  int
	AISInsecureTLS          bool
	ElasticsearchURL        string
	SearchIndexerInterval   int
}

func Load() Config {
	hasAISKey := env("AISSTREAM_API_KEY", "") != ""
	enableAIS := envBool("ENABLE_AIS", true)
	return Config{
		Port:                   env("OIL_INTEL_PORT", "8095"),
		DatabaseURL:            env("DATABASE_URL", "postgresql://postgres:password@db:5432/mining_db?sslmode=disable"),
		AISStreamAPIKey:        env("AISSTREAM_API_KEY", ""),
		EIAAPIKey:              env("EIA_API_KEY", ""),
		ComtradeAPIKey:         env("COMTRADE_API_KEY", ""),
		EnableAIS:              enableAIS && hasAISKey,
		EnableEIA:              envBool("ENABLE_EIA", true),
		EnableComtrade:         envBool("ENABLE_COMTRADE", true),
		EnableOSMImport:        envBool("ENABLE_OSM_IMPORT", false),
		ExistingBackendURL:     strings.TrimRight(env("EXISTING_BACKEND_URL", "http://backend:8000"), "/"),
		SupplierCreateEndpoint: env("SUPPLIER_CREATE_ENDPOINT", "/licenses"),
		SeedOnStartup:          envBool("OIL_INTEL_SEED_ON_STARTUP", true),
		APIBaseURL:             strings.TrimRight(env("OIL_INTEL_API_URL", "http://oil-live-intel:8095"), "/"),
		InternalBroadcastKey:   env("OIL_INTEL_INTERNAL_KEY", "oil-intel-dev"),
		AISPositionRetainHours: envInt("AIS_POSITION_RETAIN_HOURS", 72),
		AISInsecureTLS:         envBool("OIL_INTEL_AIS_INSECURE_TLS", false),
		ElasticsearchURL:       strings.TrimRight(env("ELASTICSEARCH_URL", "http://elasticsearch:9200"), "/"),
		SearchIndexerInterval:  envInt("SEARCH_INDEXER_INTERVAL_SECONDS", 300),
	}
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}
