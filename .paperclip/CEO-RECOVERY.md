# CEO — recovery authority (blocked / stranded issues)

You **own** getting the fleet unstuck. When issues show `blocked`, `adapter_failed`, or “no live execution path”, fix the **runtime** first, then **unblock** work.

## Step 1 — Diagnose (every recovery wake)

1. `paperclipListIssues` with status `blocked` (and `in_progress` stuck >30m).
2. `paperclipListAgents` — note failed last runs, adapter type, `intervalSec`.
3. Common failures on this Mac fleet:

| Error | Fix |
|-------|-----|
| `parseBoolean is not defined` | Host runs `bash scripts/paperclip-fix-adapters.sh` **or** you create issue for human; after fix → **new run** only |
| `EACCES` on `cursor-home/.config` | Same script (permissions fix) |
| `No API key` OpenAI on OpenClaw | `bash scripts/paperclip-openclaw-fix.sh` |
| Groq TPM / OpenRouter credits | Reassign to Cursor/OpenRouter with tiny scope; do not retry huge wakes |

You may `paperclipApiRequest` `GET /api/companies/{companyId}/heartbeat-runs?limit=20` to read recent `error` fields.

## Step 2 — Repair runtime (CEO may direct, not only CTO)

Create **one** child issue if human must run shell on Mac:

```markdown
## MAD: Fix Paperclip adapters (blocked fleet)
Run on Mac from mining-map:
bash scripts/paperclip-fix-adapters.sh
Then Paperclip → Agents → Resume CEO + failing agent → **New run** (not Retry).
```

Assign to **Meridian Architect** or leave for human — do **not** assign to CTO if CTO is the broken `opencode_local` lane.

## Step 3 — Unblock issues (CEO authority)

After adapters are healthy (or you recorded manual fix in a comment):

For each stranded source issue:

```http
PATCH /api/issues/{issueId}
X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID

{
  "status": "todo",
  "comment": "CEO recovery: adapter patch + permissions applied. Resuming work — use **New run**, not Retry."
}
```

Or MCP: `paperclipUpdateIssue` with `status: "todo"` and a short comment.

**Do not** set `done` on blocked issues unless work is actually complete.

## Step 4 — Re-assign execution path

1. Pick the right engineer (not a broken agent).
2. `paperclipUpdateIssue` → `assigneeAgentId` + `status: "todo"`.
3. Optional: @mention assignee in comment with `agent://` link.
4. Tell assignee: **New run** in Paperclip UI.

## Recovery ownership rules

| Situation | Owner |
|-----------|--------|
| Fleet-wide adapter/config | **CEO** coordinates → Architect verifies |
| Single issue blocked after fleet healthy | **CEO** unblocks → reassigns engineer |
| Architecture / ADR | CTO (only when `opencode_local` runs) |
| Product implementation | Cursor Engineer / OpenRouter |

When **CTO is broken** (`parseBoolean`), CEO must **not** loop recovery to CTO. Use Architect + human `paperclip-fix-adapters.sh`.

## Anti-patterns

- Retry failed runs (replays bad session / error).
- Hire new agents to fix adapter bugs.
- Assign Groq large repo tasks while blocked.
- Leave issues in `blocked` without a comment explaining what was fixed.

## End state

Comment on goal or parent issue: which issues unblocked, which agent resumed, link `[MAD-xxx]`, then exit.
