package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type tenantIDKey struct{}
type requestTxKey struct{}

// WithTenantID stores the authenticated tenant on the request context.
func WithTenantID(ctx context.Context, tenantID uuid.UUID) context.Context {
	return context.WithValue(ctx, tenantIDKey{}, tenantID)
}

// TenantIDFromContext returns the tenant UUID set by tenant RLS middleware.
func TenantIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(tenantIDKey{}).(uuid.UUID)
	return id, ok && id != uuid.Nil
}

// WithRequestTx stores a request-scoped transaction (SET LOCAL app.tenant_id applied).
func WithRequestTx(ctx context.Context, tx pgx.Tx) context.Context {
	return context.WithValue(ctx, requestTxKey{}, tx)
}

// RequestTxFromContext returns the request-scoped transaction when present.
func RequestTxFromContext(ctx context.Context) (pgx.Tx, bool) {
	tx, ok := ctx.Value(requestTxKey{}).(pgx.Tx)
	return tx, ok && tx != nil
}

// SetLocalTenantGUC applies SET LOCAL app.tenant_id inside an open transaction.
// Equivalent to SELECT set_config('app.tenant_id', $1, true).
func SetLocalTenantGUC(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID) error {
	if tenantID == uuid.Nil {
		return nil
	}
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID.String()).Scan(&ok); err != nil {
		return fmt.Errorf("set local app.tenant_id: %w", err)
	}
	return nil
}

// BindRequestTenantRLS acquires a pool connection, opens a transaction, and sets
// LOCAL app.tenant_id for the tenant. The caller must invoke release when the
// request completes. Handlers still use the shared pool today; this is a
// non-breaking stub until cutover to madsan_rls and request-tx queries.
func BindRequestTenantRLS(ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID) (context.Context, func(), error) {
	noop := func() {}
	if tenantID == uuid.Nil {
		return ctx, noop, nil
	}
	ctx = WithTenantID(ctx, tenantID)
	if pool == nil {
		return ctx, noop, nil
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return ctx, noop, fmt.Errorf("acquire conn: %w", err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		conn.Release()
		return ctx, noop, fmt.Errorf("begin tx: %w", err)
	}
	if err := SetLocalTenantGUC(ctx, tx, tenantID); err != nil {
		_ = tx.Rollback(ctx)
		conn.Release()
		return ctx, noop, err
	}
	ctx = WithRequestTx(ctx, tx)
	release := func() {
		_ = tx.Rollback(ctx)
		conn.Release()
	}
	return ctx, release, nil
}
