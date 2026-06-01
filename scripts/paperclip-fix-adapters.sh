#!/usr/bin/env bash
# Fix Paperclip adapter runtime (parseBoolean ESM bug) + agent home permissions (CEO cursor-home EACCES).
# Run on Mac after image rebuild or when CTO/opencode_local fails instantly.
#
# Usage (from mining-map):
#   bash scripts/paperclip-fix-adapters.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

echo "==> Paperclip adapter + permissions fix (agents/, pending/, cursor-home → node user)"
bash "$AI_STACK/scripts/paperclip-permissions-fix.sh"
# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-lib.sh"
# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-minimal-context.sh"
paperclip_load_env "$AI_STACK" 2>/dev/null || true
echo "==> Repair opencode agents stuck on agents/pending/opencode-home"
paperclip_repair_stale_opencode_homes 2>/dev/null || true
docker exec -u root paperclip-safe bash -lc '
  chown -R node:node /paperclip/instances/default/agents
  mkdir -p /paperclip/instances/default/agents/pending/opencode-home/.config
  chown -R node:node /paperclip/instances/default/agents/pending
' 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-ceo-cursor.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-cursor-agent.sh" 2>/dev/null || true
[[ -f "$REPO_ROOT/scripts/paperclip-antigravity-ollama.sh" ]] && bash "$REPO_ROOT/scripts/paperclip-antigravity-ollama.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-adapter-runtime-patch.sh"
bash "$AI_STACK/scripts/paperclip-opencode-providers.sh" 2>/dev/null || true
[[ -f "$REPO_ROOT/scripts/paperclip-fleet-capabilities.sh" ]] && bash "$REPO_ROOT/scripts/paperclip-fleet-capabilities.sh" 2>/dev/null || true

echo ""
echo "==> Verify opencode-local parseBoolean placement"
docker exec paperclip-safe node <<'NODE'
const fs = require("fs");
const f = "/app/packages/adapters/opencode-local/src/server/execute.ts";
const s = fs.readFileSync(f, "utf8");
const bad = /from "\.\/parse\.js";\n\nfunction parseBoolean/.test(s);
const good = /const __moduleDir[\s\S]*?function parseBoolean/.test(s);
if (bad) {
  console.error("FAIL: parseBoolean still between imports — re-run patch script");
  process.exit(1);
}
if (!good) {
  console.error("FAIL: parseBoolean missing after __moduleDir");
  process.exit(1);
}
console.log("OK: parseBoolean in valid module scope");
NODE

echo ""
echo "Done. In Paperclip UI:"
echo "  1. Agents → Resume CEO (Cursor) + CTO (Ollama) + any failed agent"
echo "  2. Start **New run** (never Retry on parseBoolean/EACCES failures)"
echo "  3. CEO: move blocked issues back to todo (see .paperclip/CEO-RECOVERY.md)"
