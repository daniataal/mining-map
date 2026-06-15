package main

import (
	"context"
	"fmt"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

func main() {
	cfg := config.Load()
	fmt.Println("url:", cfg.DatabaseURL)
	pool, err := database.ConnectURL(context.Background(), cfg.DatabaseURL)
	if err != nil {
		panic(err)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT COUNT(*)::int FROM companies`).Scan(&n); err != nil {
		panic(err)
	}
	fmt.Println("companies:", n)
}
