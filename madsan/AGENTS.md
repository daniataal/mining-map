# MadSan Intelligence — Cursor Instructions

## Mission

MadSan is a Go + Postgres/PostGIS commodity intelligence terminal: map layers, evidence-backed dossiers, deal due diligence, and admin review workflows. North star: **discover → verify → price → execute**.

This file applies to the **standalone MadSan repository** (repo root = `backend/`, `frontend/`, `deploy/`, `scripts/`). While nested in `mining-map/madsan/`, treat `madsan/` as the effective root for commands below.

## Graphify knowledge graph

After repo split, run graphify from the **MadSan repo root** (not the parent monorepo):

```bash
cd /path/to/madsan
graphify query "<task or acceptance criteria>"
graphify update .
```

- Keep a single `graphify-out/` at the MadSan root; do not duplicate under `backend/` or `frontend/`.
- Before broad architecture work, prefer `graphify query`, `graphify path`, or `graphify explain` over wide grep.
- After modifying code, run `graphify update .` so agents share current topology.

## Backend direction

Production backend is **Go** (`backend/`). No new permanent Python production subsystems.

- API entry: `backend/cmd/api`
- Workers: `backend/cmd/worker`, `backend/cmd/scheduler`
- Migrations: `backend/migrations/` (applied via API or `go run ./cmd/migrate`)

## Always follow

1. Inspect git state, compose services, and database evidence before changing behavior.
2. Do not delete data, drop volumes, expose secrets, or deploy without explicit approval and rollback.
3. Separate facts, inference, provider coverage, freshness, and confidence in UI copy.
4. Map filters query stored intelligence; they must not silently redefine ingestion scope.
5. Provide changed files, tests where practical, validation steps, limitations, and rollback.

## Local development

| Mode | Command |
|------|---------|
| Full Docker | `./scripts/compose_up.sh` |
| Hybrid | `./scripts/dev_bootstrap.sh` then `./scripts/start_api.sh` |

Compose files: `deploy/docker-compose.yml` (+ `deploy/docker-compose.prod.yml` on prod VM).

## CI

GitHub Actions: `.github/workflows/ci.yml` — frontend typecheck, `go test ./...`, API binary build. No deploy secrets in CI.

## Ops paths (standalone prod VM)

| Item | Path |
|------|------|
| Checkout | `/opt/madsan/` |
| Env file | `/opt/madsan/deploy/.env` (from `.env.example`; host-only) |
| Backups | `/opt/madsan/backups/` |
| Deploy docs | `deploy/DEPLOY.md`, `deploy/rollback.md` |

## Honest data tiers

- AIS: limited Gulf provider coverage — describe as provider-limited, not “no traffic”.
- Vessel–terminal links: inferred from destination/proximity where evidence exists.
- Ticker: EIA daily crude when `EIA_API_KEY` set; other benchmarks may be reference stubs.
- OpenSanctions: review leads, not confirmed designations.

## Future transaction caution

Marketplace, funding, insurance, and deal-execution flows remain gated by KYC/AML, sanctions, payments, custody, licensing, and jurisdictional controls. Intelligence screens alone do not imply transaction readiness.
