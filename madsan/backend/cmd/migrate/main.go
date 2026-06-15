package main

import (
	"fmt"
	"os"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

func main() {
	cfg := config.Load()
	url := cfg.DatabaseURL
	if v := os.Getenv("DATABASE_URL"); v != "" {
		url = v
	}
	if err := database.RunMigrations(url); err != nil {
		fmt.Fprintf(os.Stderr, "migrate failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("migrations applied")
}
