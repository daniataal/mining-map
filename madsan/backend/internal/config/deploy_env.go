package config

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// LoadDeployEnv loads madsan/deploy/.env into the process environment when keys are unset.
// Existing environment variables are not overwritten.
func LoadDeployEnv() {
	path := locateDeployEnv()
	if path == "" {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		val = strings.Trim(val, `"'`)
		if key == "" || os.Getenv(key) != "" {
			continue
		}
		_ = os.Setenv(key, val)
	}
}

func locateDeployEnv() string {
	if wd, err := os.Getwd(); err == nil {
		for dir := wd; ; dir = filepath.Dir(dir) {
			candidate := filepath.Join(dir, "madsan", "deploy", ".env")
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
			if filepath.Base(dir) == "madsan" {
				candidate = filepath.Join(dir, "deploy", ".env")
				if _, err := os.Stat(candidate); err == nil {
					return candidate
				}
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}
	_, self, _, ok := runtime.Caller(0)
	if !ok {
		return ""
	}
	dir := filepath.Dir(self)
	for {
		modPath := filepath.Join(dir, "go.mod")
		b, err := os.ReadFile(modPath)
		if err == nil && strings.Contains(string(b), "module "+madsanModule) {
			candidate := filepath.Join(filepath.Dir(dir), "deploy", ".env")
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}
