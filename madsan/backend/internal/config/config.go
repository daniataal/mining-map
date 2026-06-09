package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func defaultRawDir() string {
	return resolveRawDir("")
}

// resolveRawDir normalizes MADSAN_RAW_DIR for hybrid dev (cwd madsan/backend).
// Repo-relative values like "madsan/raw" must not resolve to madsan/backend/madsan/raw.
func resolveRawDir(raw string) string {
	if raw == "" {
		if wd, err := os.Getwd(); err == nil && filepath.Base(wd) == "backend" {
			raw = filepath.Join(filepath.Dir(wd), "raw")
		} else {
			raw = "../raw"
		}
	} else if !filepath.IsAbs(raw) {
		if wd, err := os.Getwd(); err == nil && filepath.Base(wd) == "backend" {
			if filepath.Base(filepath.Clean(raw)) == "raw" {
				raw = filepath.Join(filepath.Dir(wd), "raw")
			}
		}
	}
	if ap, err := filepath.Abs(raw); err == nil {
		return ap
	}
	return raw
}

type Config struct {
	Addr               string
	DatabaseURL        string
	JWTSecret          string
	CookieSecure       bool
	CookieDomain       string
	AccessTokenTTL     time.Duration
	RefreshTokenTTL    time.Duration
	RawDataDir         string
	LegacyDBURL        string
	ETLDir             string
	ETLPython          string
	LegacyImportPython bool
	EnableAISSync      bool
	AISSyncInterval    time.Duration
	EIAAPIKey            string
	OpenSanctionsAPIKey  string
}

func defaultETLDir() string {
	if wd, err := os.Getwd(); err == nil {
		if filepath.Base(wd) == "backend" {
			return filepath.Join(filepath.Dir(wd), "etl")
		}
	}
	return "../etl"
}

func Load() Config {
	etlDir := defaultETLDir()
	return Config{
		Addr:               env("MADSAN_API_ADDR", ":8088"),
		DatabaseURL:        env("DATABASE_URL", "postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable"),
		JWTSecret:          env("MADSAN_JWT_SECRET", "dev-change-me-in-production"),
		CookieSecure:       envBool("MADSAN_COOKIE_SECURE", false),
		CookieDomain:       env("MADSAN_COOKIE_DOMAIN", ""),
		AccessTokenTTL:     time.Duration(envInt("MADSAN_ACCESS_TTL_MIN", 15)) * time.Minute,
		RefreshTokenTTL:    time.Duration(envInt("MADSAN_REFRESH_TTL_DAYS", 7)) * 24 * time.Hour,
		RawDataDir:         resolveRawDir(env("MADSAN_RAW_DIR", "")),
		LegacyDBURL:        env("LEGACY_DATABASE_URL", "postgresql://postgres:password@127.0.0.1:5434/mining_db?sslmode=disable"),
		ETLDir:             env("MADSAN_ETL_DIR", etlDir),
		ETLPython:          env("MADSAN_ETL_PYTHON", filepath.Join(etlDir, ".venv", "bin", "python")),
		LegacyImportPython: envBool("MADSAN_LEGACY_PYTHON", false),
		EnableAISSync:      envBool("MADSAN_AIS_SYNC", true),
		AISSyncInterval:    time.Duration(envInt("MADSAN_AIS_SYNC_SEC", 30)) * time.Second,
		EIAAPIKey:           env("EIA_API_KEY", ""),
		OpenSanctionsAPIKey: env("OPENSANCTIONS_API_KEY", ""),
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envBool(k string, def bool) bool {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
