# Agent knowledge layers (Paperclip + Obsidian + graphify)

Meridian agents should use three complementary stores—never one mega-search.

## Layers

| Layer | System | Path | Use for |
|-------|--------|------|---------|
| Tasks | Paperclip | http://127.0.0.1:3100 | Current issue, assignee, acceptance criteria, ship comments |
| Company brain | Obsidian | `~/ai-agent-stack/obsidian-vault` (Mac), `/workspace/obsidian-vault` (containers) | Dossiers, data-source tiers, ADRs, runbooks |
| Code | Git (this repo) | `AGENTS.md`, `docs/LIVE_DATA.md`, `docs/DATA_SOURCES.md` | Implementation rules and operational truth |
| Code graph | graphify | `graphify-out/graph.json` | Architecture navigation before wide grep |

**North star:** help traders **discover → verify → price → execute** with honest data tiers—not map-only polish.

## Checkout (implementation tasks)

1. Read the Paperclip issue (or user task) for scope and done criteria.
2. Open Obsidian `MADSAN_BRAIN.md` and any linked vault folders (`06_Company-Dossiers/`, `08_Data-Sources/`, `12_Decisions/`, etc.).
3. From repo root, run graphify before large file reads:

   ```bash
   graphify query "<question derived from acceptance criteria>"
   graphify path "<symbol A>" "<symbol B>"
   graphify explain "<concept>"
   ```

4. `git branch --show-current` and `git status --short`. Paperclip agents: branch `paperclip2` only (see `.paperclip/GIT-BRANCH.md`).

## During work

- Task-scoped notes → Paperclip comments / issue documents.
- Reusable business or ops knowledge → Obsidian (not per-commit diffs).
- Code structure questions → graphify; read source only where the subgraph is insufficient.

## After shipping

1. Paperclip comment: branch, files touched, how to verify.
2. Obsidian updates only if strategy, data-source policy, or runbooks changed.
3. `graphify update .` after meaningful code edits in the session (AST-only).

## Vault mirror

Human-oriented detail and wikilinks: Obsidian note  
`09_Technical-Architecture/Meridian code navigation (graphify).md`.

## Cursor rules

- `.cursor/rules/obsidian-brain.mdc`
- `.cursor/rules/graphify.mdc`
