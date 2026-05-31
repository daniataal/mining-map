# Cursor Agent Team for Meridian / mining-map

This package adds a Cursor-native specialist team for your existing platform.

## Included Cursor configuration

- `AGENTS.md`: shared product vision, Go backend mandate and proven maritime constraints.
- `.cursor/rules/`: always-on and file-scoped architecture/quality rules.
- `.cursor/agents/`: specialist subagents for architect, Go migration, maritime, frontend, GIS/database, debugging, DevOps, security and integration.
- `.cursor/commands/`: repeatable commands for audit, Go roadmap, maritime proof/cutover, debugging and provider evaluation.
- `.cursor/skills/`: reusable task skills Cursor can discover when relevant.

## Install

Unzip this package outside the repository, then run:

```bash
bash INSTALL_CURSOR_TEAM.sh "/Users/daniatallah/Gold Project /mining-map"
```

The installer backs up an existing `.cursor/` directory and `AGENTS.md` before copying this configuration. It does not modify application source code, Docker Compose files or databases.

## Cursor features used

Cursor supports project rules (`.cursor/rules/`), `AGENTS.md`, custom subagents (`.cursor/agents/`), Agent Skills (`.cursor/skills/`) and slash workflows/commands (`.cursor/commands/`). Use Plan Mode for audit/architecture work before permitting implementation.

## First use

In Cursor, start in Plan Mode and run `/audit-platform`, or paste the prompt in `FIRST_CURSOR_PROMPT.md`.

## Immediate project direction encoded here

- Backend must migrate to Go in controlled phases.
- Maritime permanent backend work belongs in Go `oil-live-intel`.
- Do not introduce a new Python AIS ingestion pipeline.
- Complete Go ownership of maritime health/status before removing the redundant Python websocket worker.
- Middle East missing AIS data must be shown as limited provider coverage, not no tanker activity.
