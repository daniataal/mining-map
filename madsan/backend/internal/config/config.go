package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	madsanModule   = "github.com/madsan/intelligence"
	rawSeedMarker  = "bunker_fuel_suppliers_seed.json"
)

// resolveRawDir resolves MADSAN_RAW_DIR to an absolute path.
// Default and repo-relative values (madsan/raw, raw, ../raw) map to madsan/raw next to
// madsan/backend, independent of process cwd — avoids …/backend/madsan/raw when the worker
// runs from madsan/backend with MADSAN_RAW_DIR=madsan/raw or "$(pwd)/madsan/raw".
func resolveRawDir(raw string) string {
	if raw == "" || isMadsanRawReference(raw) {
		if dir := locateMadsanRawDir(); dir != "" {
			return dir
		}
	}

	candidate := raw
	wasRelative := !filepath.IsAbs(candidate)
	if wasRelative {
		if ap, err := filepath.Abs(candidate); err == nil {
			candidate = ap
		}
	}

	if isWrongBackendRawPath(candidate) {
		if dir := locateMadsanRawDir(); dir != "" {
			return dir
		}
	}

	// Relative paths that do not exist (e.g. cwd=madsan/backend + madsan/raw) → auto-locate.
	// Absolute paths (e.g. Docker /raw) pass through even when the dir is not mounted yet.
	if wasRelative && !isUsableRawDir(candidate) {
		if dir := locateMadsanRawDir(); dir != "" {
			return dir
		}
	}

	return candidate
}

func isMadsanRawReference(raw string) bool {
	switch filepath.Clean(raw) {
	case "raw", "../raw", "./raw", "madsan/raw", "./madsan/raw":
		return true
	default:
		return false
	}
}

func isUsableRawDir(dir string) bool {
	if dir == "" || isWrongBackendRawPath(dir) {
		return false
	}
	st, err := os.Stat(dir)
	return err == nil && st.IsDir()
}

func isWrongBackendRawPath(dir string) bool {
	clean := filepath.Clean(dir)
	parts := strings.Split(clean, string(filepath.Separator))
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "backend" && parts[i+1] == "madsan" && parts[i+2] == "raw" {
			return true
		}
	}
	return false
}

func rawDirHasSeed(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, rawSeedMarker))
	return err == nil
}

// locateMadsanRawDir walks up from the executable, cwd, and this package to find madsan/raw.
func locateMadsanRawDir() string {
	anchors := make([]string, 0, 3)
	if _, self, _, ok := runtime.Caller(0); ok {
		anchors = append(anchors, filepath.Dir(self))
	}
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		anchors = append(anchors, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		anchors = append(anchors, wd)
	}
	for _, anchor := range anchors {
		if dir := walkUpForRawDir(anchor); dir != "" {
			return dir
		}
	}
	return ""
}

func walkUpForRawDir(start string) string {
	dir := start
	for {
		if raw := rawBesideBackendMod(dir); raw != "" {
			return raw
		}
		raw := filepath.Join(dir, "raw")
		if isUsableRawDir(raw) && !isWrongBackendRawPath(raw) {
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

func rawBesideBackendMod(start string) string {
	dir := start
	for {
		modPath := filepath.Join(dir, "go.mod")
		b, err := os.ReadFile(modPath)
		if err == nil && strings.Contains(string(b), "module "+madsanModule) {
			raw := filepath.Join(filepath.Dir(dir), "raw")
			if isUsableRawDir(raw) {
				if ap, err := filepath.Abs(raw); err == nil {
					return ap
				}
				return raw
			}
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
	Addr                      string
	DatabaseURL               string
	JWTSecret                 string
	CookieSecure              bool
	CookieDomain              string
	AccessTokenTTL            time.Duration
	RefreshTokenTTL           time.Duration
	RawDataDir                string
	LegacyDBURL               string
	ETLDir                    string
	ETLPython                 string
	LegacyImportPython        bool
	EnableAISSync             bool
	EnableAISDirect           bool
	AISSyncInterval           time.Duration
	AISSyncLookbackHours      int
	AISStreamAPIKey           string
	AISRetainDays             int
	AISInsecureTLS            bool
	AISAutoTLSFallback        bool
	AISCycleMinutes           int
	AISPositionMinIntervalSec int
	AISGeofenceRadiusM        float64
	AISTerminalBufferDeg      float64
	EIAAPIKey                 string
	OpenSanctionsAPIKey       string
	DocumentsDir              string
	GroqAPIKey                string
	OpenRouterAPIKey          string
	ShipVaultEnabled          bool
	ShipVaultBearerToken      string
	ShipVaultRefreshToken     string
	ShipVaultSessionJSON      string
	ShipVaultEmail            string
	ShipVaultPassword         string
	ShipVaultFirebaseAPIKey   string
	ShipVaultBaseURL          string
	ShipVaultAppOriginURL     string
	ShipVaultCacheTTLDays     int
	VesselEnrichmentBatch     int
	VesselEnrichmentStaleDays int
	VesselEnrichmentRateMS    int
	GLEIFUserAgent            string
	GLEIFBatchLimit           int
	SECEdgarUserAgent         string
	SECEdgarBatchLimit        int
	// GrantMapPremiumLayers unlocks pipelines MVT for local dev (default when JWT secret is dev default).
	GrantMapPremiumLayers bool
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
	// Worker/scheduler CLIs do not source deploy/.env via shell; load unset keys here.
	LoadDeployEnv()
	etlDir := defaultETLDir()
	return Config{
		Addr:                      env("MADSAN_API_ADDR", ":8088"),
		DatabaseURL:               env("DATABASE_URL", "postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable"),
		JWTSecret:                 env("MADSAN_JWT_SECRET", "dev-change-me-in-production"),
		CookieSecure:              envBool("MADSAN_COOKIE_SECURE", false),
		CookieDomain:              env("MADSAN_COOKIE_DOMAIN", ""),
		AccessTokenTTL:            time.Duration(envInt("MADSAN_ACCESS_TTL_MIN", 15)) * time.Minute,
		RefreshTokenTTL:           time.Duration(envInt("MADSAN_REFRESH_TTL_DAYS", 7)) * 24 * time.Hour,
		RawDataDir:                resolveRawDir(env("MADSAN_RAW_DIR", "")),
		LegacyDBURL:               env("LEGACY_DATABASE_URL", "postgresql://postgres:password@127.0.0.1:5434/mining_db?sslmode=disable"),
		ETLDir:                    env("MADSAN_ETL_DIR", etlDir),
		ETLPython:                 env("MADSAN_ETL_PYTHON", filepath.Join(etlDir, ".venv", "bin", "python")),
		LegacyImportPython:        envBool("MADSAN_LEGACY_PYTHON", false),
		EnableAISSync:             envBool("MADSAN_AIS_SYNC", true),
		EnableAISDirect:           envBool("MADSAN_AIS_DIRECT", env("AISSTREAM_API_KEY", "") != ""),
		AISSyncInterval:           time.Duration(envInt("MADSAN_AIS_SYNC_SEC", 30)) * time.Second,
		AISSyncLookbackHours:      envInt("MADSAN_AIS_SYNC_LOOKBACK_HOURS", 168),
		AISStreamAPIKey:           env("AISSTREAM_API_KEY", ""),
		AISRetainDays:             envInt("MADSAN_AIS_RETAIN_DAYS", 30),
		AISInsecureTLS:            envBool("MARITIME_SSL_VERIFY", true) == false,
		AISAutoTLSFallback:        envBool("MARITIME_SSL_AUTO_FALLBACK", true),
		AISCycleMinutes:           envInt("MADSAN_AIS_CYCLE_MIN", 20),
		AISPositionMinIntervalSec: envInt("MADSAN_AIS_POSITION_MIN_SEC", 90),
		AISGeofenceRadiusM:        envFloat("MADSAN_AIS_GEOFENCE_RADIUS_M", 1200),
		AISTerminalBufferDeg:      envFloat("MADSAN_AIS_TERMINAL_BUFFER_DEG", 0.45),
		EIAAPIKey:                 env("EIA_API_KEY", ""),
		OpenSanctionsAPIKey:       env("OPENSANCTIONS_API_KEY", ""),
		DocumentsDir:              env("MADSAN_DOCUMENTS_DIR", ""),
		GroqAPIKey:                env("GROQ_API_KEY", env("GROQ_AI_API_KEY", "")),
		OpenRouterAPIKey:          env("OPENROUTER_API_KEY", env("OPENROUTER_AI_API_KEY", "")),
		ShipVaultEnabled:          envBool("MADSAN_SHIPVAULT_ENABLED", false),
		ShipVaultBearerToken:      env("SHIPVAULT_BEARER_TOKEN", ""),
		ShipVaultRefreshToken:     env("SHIPVAULT_REFRESH_TOKEN", ""),
		ShipVaultSessionJSON:      env("SHIPVAULT_SESSION_JSON", ""),
		ShipVaultEmail:            env("SHIPVAULT_EMAIL", ""),
		ShipVaultPassword:         env("SHIPVAULT_PASSWORD", ""),
		ShipVaultFirebaseAPIKey:   env("SHIPVAULT_FIREBASE_API_KEY", ""),
		ShipVaultBaseURL:          env("SHIPVAULT_BASE_URL", "https://shipvaultapi-gjb8c.ondigitalocean.app"),
		ShipVaultAppOriginURL:     env("SHIPVAULT_APP_ORIGIN_URL", "https://app.shipvault.io"),
		ShipVaultCacheTTLDays:     envInt("SHIPVAULT_CACHE_TTL_DAYS", 120),
		VesselEnrichmentBatch:     envInt("MADSAN_VESSEL_ENRICHMENT_BATCH", 50),
		VesselEnrichmentStaleDays: envInt("MADSAN_VESSEL_ENRICHMENT_STALE_DAYS", 120),
		VesselEnrichmentRateMS:    envInt("MADSAN_VESSEL_ENRICHMENT_RATE_MS", 500),
		GLEIFUserAgent:            env("GLEIF_USER_AGENT", "MadSanIntelligence/1.0 (open-data research)"),
		GLEIFBatchLimit:           envInt("GLEIF_BATCH_LIMIT", 50),
		SECEdgarUserAgent:         env("SEC_EDGAR_USER_AGENT", "MadSanIntelligence/1.0 (open-data research)"),
		SECEdgarBatchLimit:        envInt("SEC_EDGAR_BATCH_LIMIT", 25),
		GrantMapPremiumLayers:     grantMapPremiumLayersDefault(),
	}
}

func grantMapPremiumLayersDefault() bool {
	if v := os.Getenv("MADSAN_GRANT_MAP_PREMIUM_LAYERS"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return env("MADSAN_JWT_SECRET", "dev-change-me-in-production") == "dev-change-me-in-production"
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

func envFloat(k string, def float64) float64 {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}
