package database

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	return ConnectURL(ctx, os.Getenv("DATABASE_URL"))
}

func ConnectURL(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if url == "" {
		url = "postgresql://postgres:password@127.0.0.1:5433/madsan_db?sslmode=disable"
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if max := maxConns(); max > 0 {
		cfg.MaxConns = max
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}

func maxConns() int32 {
	if v := os.Getenv("MADSAN_DB_MAX_CONNS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return int32(n)
		}
	}
	return 10
}

func Ping(ctx context.Context, pool *pgxpool.Pool) error {
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	return nil
}
