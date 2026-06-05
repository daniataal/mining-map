package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                   string
	DatabaseURL            string
	AISStreamAPIKey        string
	EIAAPIKey              string
	ComtradeAPIKey         string
	EnableAIS              bool
	EnableEIA              bool
	EnableComtrade         bool
	EnableOSMImport        bool
	ExistingBackendURL     string
	SupplierCreateEndpoint string
	SeedOnStartup          bool
	DisableDemoSeed        bool
	APIBaseURL             string
	InternalBroadcastKey   string
	AISPositionRetainHours int
	AISInsecureTLS         bool
	AISAutoTLSFallback     bool
	ElasticsearchURL       string
	SearchIndexerInterval  int

	// ShipVault vessel registry enrichment (optional).
	// When ShipVaultEnabled=true, the dossier API fetches owner, builder,
	// name history and estimated value on-demand and caches in Postgres.
	ShipVaultEnabled               bool
	ShipVaultBearerToken           string
	ShipVaultRefreshToken          string
	ShipVaultSessionJSON           string
	ShipVaultEmail                 string
	ShipVaultPassword              string
	ShipVaultFirebaseAPIKey        string
	ShipVaultAppOriginURL          string
	ShipVaultCacheTTLDays          int
	ShipVaultBaseURL               string
	ShipVaultBootstrapAllowed      bool
	ShipVaultBackfillEnabled       bool
	ShipVaultBackfillLimit         int
	ShipVaultBackfillIntervalHours int
}

// ShipVaultConfigured reports whether ShipVault should run (env credentials or DB refresh token).
func (c Config) ShipVaultConfigured(hasDBRefreshToken bool) bool {
	return c.ShipVaultEnabled || hasDBRefreshToken
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
		DisableDemoSeed:        envDisableDemoSeed("OIL_LIVE_DISABLE_DEMO_SEED"),
		APIBaseURL:             strings.TrimRight(env("OIL_INTEL_API_URL", "http://oil-live-intel:8095"), "/"),
		InternalBroadcastKey:   env("OIL_INTEL_INTERNAL_KEY", "oil-intel-dev"),
		AISPositionRetainHours: envInt("AIS_POSITION_RETAIN_HOURS", 72),
		AISInsecureTLS:         aisInsecureTLS(),
		AISAutoTLSFallback:     aisAutoTLSFallback(),
		ElasticsearchURL:       strings.TrimRight(env("ELASTICSEARCH_URL", "http://elasticsearch:9200"), "/"),
		SearchIndexerInterval:  envInt("SEARCH_INDEXER_INTERVAL_SECONDS", 300),

		// ShipVault: enabled when any supported credential is present.
		ShipVaultBearerToken:           env("SHIPVAULT_BEARER_TOKEN", ""),
		ShipVaultRefreshToken:          env("SHIPVAULT_REFRESH_TOKEN", ""),
		ShipVaultSessionJSON:           env("SHIPVAULT_SESSION_JSON", ""),
		ShipVaultEmail:                 env("SHIPVAULT_EMAIL", ""),
		ShipVaultPassword:              env("SHIPVAULT_PASSWORD", ""),
		ShipVaultFirebaseAPIKey:        env("SHIPVAULT_FIREBASE_API_KEY", ""),
		ShipVaultAppOriginURL:          strings.TrimRight(env("SHIPVAULT_APP_ORIGIN_URL", "https://app.shipvault.io"), "/"),
		ShipVaultCacheTTLDays:          envInt("SHIPVAULT_CACHE_TTL_DAYS", 7),
		ShipVaultBaseURL:               strings.TrimRight(env("SHIPVAULT_BASE_URL", "https://shipvaultapi-gjb8c.ondigitalocean.app"), "/"),
		ShipVaultEnabled:               shipVaultEnabled(),
		ShipVaultBootstrapAllowed:      envBool("SHIPVAULT_BOOTSTRAP_ALLOWED", false),
		ShipVaultBackfillEnabled:       envBool("SHIPVAULT_BACKFILL_ENABLED", true),
		ShipVaultBackfillLimit:         envInt("SHIPVAULT_BACKFILL_LIMIT", 25),
		ShipVaultBackfillIntervalHours: envInt("SHIPVAULT_BACKFILL_INTERVAL_HOURS", 24),
	}
}

func shipVaultEnabled() bool {
	if strings.TrimSpace(env("SHIPVAULT_BEARER_TOKEN", "")) != "" {
		return true
	}
	if strings.TrimSpace(env("SHIPVAULT_REFRESH_TOKEN", "")) != "" {
		return true
	}
	if strings.TrimSpace(env("SHIPVAULT_SESSION_JSON", "")) != "" {
		return true
	}
	return strings.TrimSpace(env("SHIPVAULT_EMAIL", "")) != "" &&
		strings.TrimSpace(env("SHIPVAULT_PASSWORD", "")) != ""
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

// envDisableDemoSeed returns true when demo seeds should be skipped (default true).
// aisInsecureTLS mirrors Python MARITIME_SSL_VERIFY=0 for expired upstream AISStream certs.
func aisInsecureTLS() bool {
	if envBool("OIL_INTEL_AIS_INSECURE_TLS", false) {
		return true
	}
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("MARITIME_SSL_VERIFY")))
	return raw == "0" || raw == "false" || raw == "no" || raw == "off"
}

// aisAutoTLSFallback mirrors Python MARITIME_SSL_AUTO_FALLBACK (default on).
func aisAutoTLSFallback() bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv("MARITIME_SSL_AUTO_FALLBACK")))
	if raw == "" {
		return true
	}
	switch raw {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func envDisableDemoSeed(key string) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return true
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}
