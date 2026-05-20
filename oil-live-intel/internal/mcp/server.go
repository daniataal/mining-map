package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/config"
)

// RunStdio serves MCP JSON-RPC over stdin/stdout.
func RunStdio(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) error {
	h := &ToolHandler{Pool: pool, Config: cfg}
	in := bufio.NewReader(os.Stdin)
	out := os.Stdout

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		line, err := in.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		if len(line) == 0 {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		resp := handleRequest(ctx, h, &req)
		if req.ID == nil {
			continue
		}
		resp["jsonrpc"] = "2.0"
		resp["id"] = req.ID
		b, _ := json.Marshal(resp)
		_, _ = out.Write(append(b, '\n'))
	}
}

type rpcRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id"`
	Method  string         `json:"method"`
	Params  map[string]any `json:"params"`
}

func handleRequest(ctx context.Context, h *ToolHandler, req *rpcRequest) map[string]any {
	switch req.Method {
	case "initialize":
		return map[string]any{
			"result": map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo": map[string]any{
					"name":    "oil-live-intel",
					"version": "1.0.0",
				},
			},
		}
	case "notifications/initialized", "initialized":
		return map[string]any{}
	case "tools/list":
		return map[string]any{"result": map[string]any{"tools": ListToolDefs()}}
	case "tools/call":
		params := req.Params
		name, _ := params["name"].(string)
		args, _ := params["arguments"].(map[string]any)
		if args == nil {
			args = map[string]any{}
		}
		if name == "oil_live_save_to_suppliers" {
			auth := strVal(args, "auth_token")
			cid := strVal(args, "company_id")
			text, err := h.SaveToSuppliers(ctx, cid, auth)
			if err != nil {
				return errResp(err)
			}
			return toolResult(text)
		}
		text, err := h.Call(ctx, name, args)
		if err != nil {
			return errResp(err)
		}
		return toolResult(text)
	default:
		return map[string]any{"error": map[string]any{"code": -32601, "message": "method not found: " + req.Method}}
	}
}

func toolResult(text string) map[string]any {
	return map[string]any{
		"result": map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": text},
			},
		},
	}
}

func errResp(err error) map[string]any {
	return map[string]any{
		"result": map[string]any{
			"content": []map[string]any{
				{"type": "text", "text": fmt.Sprintf("Error: %v", err)},
			},
			"isError": true,
		},
	}
}
