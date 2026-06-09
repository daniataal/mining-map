package database

import (
	"fmt"
	"os"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	mig "github.com/madsan/intelligence/migrations"
)

func RunMigrations(databaseURL string) error {
	if databaseURL == "" {
		databaseURL = os.Getenv("DATABASE_URL")
	}
	d, err := iofs.New(mig.FS, ".")
	if err != nil {
		return fmt.Errorf("migration fs: %w", err)
	}
	m, err := migrate.NewWithSourceInstance("iofs", d, databaseURL)
	if err != nil {
		return fmt.Errorf("migrate new: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
