package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const madsanModule = "github.com/madsan/intelligence"

// resolveRawDir resolves MADSAN_RAW_DIR to an absolute path.
// Default and repo-relative values (madsan/raw, raw, ../raw) map to madsan/raw next to
// madsan/backend, independent of process cwd — avoids …/backend/madsan/raw when the worker
// runs from madsan/backend with MADSAN_RAW_DIR=madsan/raw.
func resolveRawDir(raw string) string {
	if raw == "" || isMadsanRawReference(raw) {
		if dir := locateMadsanRawDir(); dir != "" {
			return dir
		}
	}
	if filepath.IsAbs(raw) {
		return raw
	}
	if ap, err := filepath.Abs(raw); err == nil {
		return ap
	}
	return raw
}

func isMadsanRawReference(raw string) bool {
	switch filepath.Clean(raw) {
	case "raw", "../raw", "./raw", "madsan/raw", "./madsan/raw":
		return true
	default:
		return false
	}
}

// locateMadsanRawDir walks up from this package to github.com/madsan/intelligence go.mod
// and returns ../raw (i.e. madsan/raw in the repo layout).
func locateMadsanRawDir() string {
	_, self, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	dir := filepath.Dir(self)
	for {
		modPath := filepath.Join(dir, "go.mod")
		b, err := os.ReadFile(modPath)
		if err == nil && strings.Contains(string(b), "module "+madsanModule) {
			raw := filepath.Join(filepath.Dir(dir), "raw")
			if ap, err := filepath.Abs(raw); err == nil {
				return ap
			}
			return raw
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
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
	EnableAISSync         bool
	AISSyncInterval       time.Duration
	AISSyncLookbackHours  int
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
		EnableAISSync:        envBool("MADSAN_AIS_SYNC", true),
		AISSyncInterval:      time.Duration(envInt("MADSAN_AIS_SYNC_SEC", 30)) * time.Second,
		AISSyncLookbackHours: envInt("MADSAN_AIS_SYNC_LOOKBACK_HOURS", 168),
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
