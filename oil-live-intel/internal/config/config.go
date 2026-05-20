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
	}
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
