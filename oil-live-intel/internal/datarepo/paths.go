package datarepo

import (
	"os"
	"path/filepath"
)

const anchorFile = "storage_terminals_seed.json"

// Dir returns the repo data directory containing seed JSON files.
// Honors MERIDIAN_DATA_DIR when set (Docker: /data/meridian).
func Dir() string {
	if env := os.Getenv("MERIDIAN_DATA_DIR"); env != "" {
		return env
	}
	// Walk up from cwd looking for data/storage_terminals_seed.json
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 6; i++ {
			candidate := filepath.Join(dir, "data")
			if fileExists(filepath.Join(candidate, anchorFile)) {
				return candidate
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return filepath.Join("data")
}

// File returns path to a seed JSON file in the repo data directory.
func File(name string) string {
	return filepath.Join(Dir(), name)
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
