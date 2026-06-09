package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func brokerUserID(r *http.Request) string {
	if uid := r.Header.Get("X-User-Id"); uid != "" {
		return uid
	}
	if uid := r.URL.Query().Get("user_id"); uid != "" {
		return uid
	}
	return "default"
}

func (s *Server) assertWorkspaceOwner(ctx context.Context, wsID, userID string) error {
	var owner string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM user_workspaces WHERE id = $1`, wsID).Scan(&owner)
	if err == pgx.ErrNoRows {
		return errWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if owner != userID {
		return errWorkspaceForbidden
	}
	return nil
}

func (s *Server) assertPackInWorkspace(ctx context.Context, wsID, packID, userID string) error {
	if err := s.assertWorkspaceOwner(ctx, wsID, userID); err != nil {
		return err
	}
	var found string
	err := s.Pool.QueryRow(ctx, `
		SELECT id FROM broker_deal_packs WHERE id = $1 AND workspace_id = $2 AND user_id = $3
	`, packID, wsID, userID).Scan(&found)
	if err == pgx.ErrNoRows {
		return errPackNotFound
	}
	return err
}

var (
	errWorkspaceNotFound  = &brokerErr{msg: "workspace not found", code: http.StatusNotFound}
	errWorkspaceForbidden = &brokerErr{msg: "forbidden", code: http.StatusForbidden}
	errPackNotFound       = &brokerErr{msg: "pack not found", code: http.StatusNotFound}
	errEntityNotFound     = &brokerErr{msg: "entity not found", code: http.StatusNotFound}
	errInvalidRequest     = &brokerErr{msg: "invalid request", code: http.StatusBadRequest}
)

type brokerErr struct {
	msg  string
	code int
}

func (e *brokerErr) Error() string { return e.msg }

func writeBrokerErr(w http.ResponseWriter, err error) {
	if be, ok := err.(*brokerErr); ok {
		writeJSON(w, be.code, map[string]string{"error": be.msg})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

func workspaceIDFromRequest(r *http.Request) string {
	return chi.URLParam(r, "id")
}

func packIDFromRequest(r *http.Request) string {
	return chi.URLParam(r, "pid")
}

func entityIDFromRequest(r *http.Request) string {
	return chi.URLParam(r, "eid")
}

func brokerJSONOrEmpty(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(b)
}
