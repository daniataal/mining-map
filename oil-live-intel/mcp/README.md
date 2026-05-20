# oil-live-intel MCP Server

Stdio MCP server for Cursor / Claude Desktop — acts on live oil intelligence without exposing API keys to the model.

## Run locally

```bash
cd oil-live-intel
DATABASE_URL="postgresql://postgres:password@localhost:5432/mining_db?sslmode=disable" \
  go run ./cmd/mcp
```

## Cursor configuration

Add to `.cursor/mcp.json` (project root):

```json
{
  "mcpServers": {
    "oil-live-intel": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URL=postgresql://postgres:password@db:5432/mining_db?sslmode=disable",
        "--network", "mining-map_default",
        "mining-map-oil-live-intel:latest",
        "/app/mcp"
      ]
    }
  }
}
```

Or use `go run ./cmd/mcp` with local `DATABASE_URL`.

## Tools

| Tool | Description |
|------|-------------|
| `oil_live_map_snapshot` | Terminals + opportunities |
| `oil_live_explain_event` | Port call evidence (`port_call_id`) |
| `oil_live_list_opportunities` | Open opportunities |
| `oil_live_company_profile` | Company + terminals (`company_id`) |
| `oil_live_company_contacts` | Contacts + TED procurement (`company_id`) |
| `oil_live_draft_outreach` | Outreach email draft |
| `oil_live_save_to_suppliers` | Save to Suppliers (`company_id`, `auth_token`) |
| `oil_live_logistics_hint` | Route planner prefill (`terminal_id`) |

All outputs use **possible/inferred** language — never confirmed transactions.
