package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/database"
)

type legacyImportOpts struct {
	Tables     []string
	MaxRows    int
	DryRun     bool
	UsePython  bool
}

func parseLegacyImportOpts(payload []byte) legacyImportOpts {
	opts := legacyImportOpts{}
	if len(payload) == 0 {
		return opts
	}
	var m map[string]any
	if json.Unmarshal(payload, &m) != nil {
		return opts
	}
	if raw, ok := m["tables"].([]any); ok {
		for _, t := range raw {
			if s, ok := t.(string); ok && s != "" {
				opts.Tables = append(opts.Tables, s)
			}
		}
	}
	if s, ok := m["tables"].(string); ok && s != "" {
		opts.Tables = strings.Split(s, ",")
	}
	if n, ok := m["max_rows"].(float64); ok {
		opts.MaxRows = int(n)
	}
	if b, ok := m["dry_run"].(bool); ok {
		opts.DryRun = b
	}
	if b, ok := m["use_python"].(bool); ok {
		opts.UsePython = b
	}
	return opts
}

func (s *Service) processLegacyImport(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := parseLegacyImportOpts(payload)
	if !opts.UsePython && !s.cfg.LegacyImportPython {
		return s.processLegacyImportGo(ctx, jobID, payload)
	}
	started := time.Now()
	if s.cfg.LegacyDBURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL not configured")
	}
	probe, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		return fmt.Errorf("legacy db connect: %w", err)
	}
	probe.Close()

	before, _ := s.countPendingLegacyETL(ctx)
	report, err := s.runLegacyImportScript(ctx, opts)
	if err != nil {
		_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='failed', error_message=$2, finished_at=now() WHERE id=$1`, jobID, err.Error())
		return err
	}
	after, _ := s.countPendingLegacyETL(ctx)
	report["child_jobs_enqueued"] = after - before
	if report["child_jobs_enqueued"].(int) < 0 {
		report["child_jobs_enqueued"] = 0
	}
	report["dry_run"] = opts.DryRun
	b := buildLegacyImportReport(report, started)
	_, _ = s.pool.Exec(ctx, `UPDATE ingestion_jobs SET status='completed', result_report=$2, finished_at=now() WHERE id=$1`, jobID, b)
	return nil
}

func (s *Service) countPendingLegacyETL(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM ingestion_jobs
		WHERE job_type = 'legacy_etl' AND status = 'pending'
	`).Scan(&n)
	return n, err
}

func (s *Service) runLegacyImportScript(ctx context.Context, opts legacyImportOpts) (map[string]any, error) {
	etlDir := s.cfg.ETLDir
	python := s.cfg.ETLPython
	script := filepath.Join(etlDir, "legacy_import.py")
	if _, err := os.Stat(script); err != nil {
		return nil, fmt.Errorf("legacy_import.py not found at %s", script)
	}
	if _, err := os.Stat(python); err != nil {
		return nil, fmt.Errorf("python not found at %s (run: python3 -m venv %s/.venv && pip install psycopg2-binary)", python, etlDir)
	}

	runCtx, cancel := context.WithTimeout(ctx, 45*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(runCtx, python, script)
	cmd.Dir = filepath.Dir(etlDir)
	cmd.Env = append(os.Environ(),
		"DATABASE_URL="+s.cfg.DatabaseURL,
		"LEGACY_DATABASE_URL="+s.cfg.LegacyDBURL,
	)
	if len(opts.Tables) > 0 {
		cmd.Env = append(cmd.Env, "ETL_TABLES="+strings.Join(opts.Tables, ","))
	}
	if opts.MaxRows > 0 {
		cmd.Env = append(cmd.Env, fmt.Sprintf("ETL_MAX_ROWS=%d", opts.MaxRows))
	}
	if opts.DryRun {
		cmd.Env = append(cmd.Env, "ETL_DRY_RUN=true")
	}

	out, err := cmd.CombinedOutput()
	output := strings.TrimSpace(string(out))
	if err != nil {
		return nil, fmt.Errorf("legacy import: %w\n%s", err, tailLines(output, 8))
	}

	report := map[string]any{
		"orchestrator": "legacy_import.py",
		"tables":       opts.Tables,
		"stdout_tail":  tailLines(output, 4),
	}
	if stats := parseLegacyStatsLine(output); stats != nil {
		report["legacy_counts"] = stats
	}
	return report, nil
}

func parseLegacyStatsLine(output string) map[string]any {
	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var stats map[string]any
		if json.Unmarshal([]byte(line), &stats) == nil {
			return stats
		}
	}
	return nil
}

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) <= n {
		return s
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}
