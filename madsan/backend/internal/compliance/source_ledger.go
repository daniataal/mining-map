package compliance

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BlockedSource is a source key blocked from commercial use.
type BlockedSource struct {
	Key         string `json:"source_key"`
	DisplayName string `json:"display_name"`
	LicenseName string `json:"license_name,omitempty"`
	Attribution string `json:"attribution,omitempty"`
	TermsURL    string `json:"terms_url,omitempty"`
}

type SourceLedger struct {
	pool *pgxpool.Pool
}

func NewSourceLedger(pool *pgxpool.Pool) *SourceLedger {
	return &SourceLedger{pool: pool}
}

func (l *SourceLedger) BlockingKeys(ctx context.Context, keys []string) ([]BlockedSource, error) {
	keys = normalizeKeys(keys)
	if len(keys) == 0 || l == nil || l.pool == nil {
		return nil, nil
	}
	rows, err := l.pool.Query(ctx, `
		SELECT source_key, display_name, COALESCE(license_name,''), COALESCE(attribution,''), COALESCE(terms_url,'')
		FROM core_source_ledger
		WHERE source_key = ANY($1) AND enabled = true AND commercial_use_ok = false
	`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var blocked []BlockedSource
	for rows.Next() {
		var b BlockedSource
		if err := rows.Scan(&b.Key, &b.DisplayName, &b.LicenseName, &b.Attribution, &b.TermsURL); err != nil {
			return nil, err
		}
		blocked = append(blocked, b)
	}
	return blocked, rows.Err()
}

// ParseSourceKeys normalizes comma-separated source key headers/query params.
func ParseSourceKeys(raw string) []string {
	if raw == "" {
		return nil
	}
	return normalizeKeys(strings.Split(raw, ","))
}

func normalizeKeys(parts []string) []string {
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		k := strings.TrimSpace(strings.ToLower(part))
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

// CommercialUseError formats a 403 message for blocked non-commercial sources.
func CommercialUseError(blocked []BlockedSource) string {
	if len(blocked) == 0 {
		return "source not licensed for commercial use"
	}
	parts := make([]string, 0, len(blocked))
	for _, b := range blocked {
		msg := b.DisplayName
		if msg == "" {
			msg = b.Key
		}
		if b.LicenseName != "" {
			msg += " (" + b.LicenseName + ")"
		}
		if b.Attribution != "" {
			msg += " — " + b.Attribution
		}
		parts = append(parts, msg)
	}
	return fmt.Sprintf("paid feature blocked: non-commercial source(s): %s", strings.Join(parts, "; "))
}
