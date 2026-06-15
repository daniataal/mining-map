# Agent Collaboration Protocol

## Purpose

Use this when Codex and Cursor are both working on MadSan.

The goal is to avoid collisions, preserve user changes, and keep intelligence labels/data logic correct.

## Ownership Rules

- One agent owns one task at a time.
- One agent owns one file at a time when possible.
- Cursor should focus on frontend/product UX unless explicitly assigned backend work.
- Codex owns backend intelligence logic, SQL/data correctness, source adapters, and final review.
- Neither agent should edit `mining-viz/` for MadSan work.
- Neither agent should rewrite unrelated files or apply broad formatting.

## Before Starting Work

Run from repo root:

`git status --short`

If there are changes in the same files you need to edit:

- inspect them first
- assume they are user/agent work
- do not revert them
- work with them or stop for review if there is a direct conflict

For broad work, run:

`graphify query "<task summary>"`

## During Work

- Keep changes small and reviewable.
- Do not introduce new permanent Python production paths.
- Do not add duplicate AIS/vessel/provider systems.
- Do not commit raw GEM/JODI/source datasets.
- Preserve evidence labels:
  - `observed`
  - `reported`
  - `source-backed`
  - `movement-derived`
  - `inferred`
  - `estimated`
  - `predicted`
- Never turn inferred cargo, buyer, owner, margin, or price context into confirmed fact.
- Never present model-implied price context as guaranteed prediction or trading advice.

## Handoff Format

Each agent should report:

- changed files
- product behavior changed
- data/API assumptions
- commands run
- browser URLs checked
- known limitations
- rollback notes if relevant

## Review Gate

Codex reviews after Cursor.

Review checks:

- no `mining-viz/` edits
- no unrelated formatting
- no broad client-side scans where targeted API exists
- TypeScript passes
- Go tests pass when backend touched
- `git diff --check` passes
- browser verifies main affected route
- evidence labels are honest
- no fake actions or unimplemented API promises

## Conflict Recovery

If both agents touched the same file:

1. Compare diffs before editing.
2. Keep both valid changes when possible.
3. Prefer the latest user-approved product direction.
4. Re-run tests.
5. Ask the user only if two changes are logically incompatible.
