# Phase 1 — browser checklist (product sign-off)

Run against **Caddy** [http://127.0.0.1:8080](http://127.0.0.1:8080) (not backend :8000 alone).

**Prep (dev):** `./scripts/seed_hormuz_crisis_demo.sh` so Crisis desk shows `top_corridors`.

| # | Action | Pass when |
|---|--------|-----------|
| 1 | Open Live Data / Oil map | No console errors; map tiles load |
| 2 | Toggle **terminals**, **trade flow** / MCR corridors | Layers respond; bbox refetch feels &lt; ~2s |
| 3 | Pan to **Persian Gulf / Hormuz** | Limited-coverage or watch-zone gap copy visible (not “no traffic”) |
| 4 | Click a **vessel** or **cargo** marker (if any) | Drawer: `bol_tier`, evidence; synthetic/customs labeled |
| 5 | **Search** (top bar) `aramco` or `vopak` | Results list; click opens drawer or flies map |
| 6 | Lens **Raw** → enable **EIA historic** (if toggle present) | Historic arcs; disclaimer / `bol_tier=historic` visible |
| 7 | Intel panel → **customs_open** count | UK (or Brazil) open-tier badge; not paid BOL copy |
| 8 | Open an **opportunity** → **Deal Execution Pack** → **Export MD** / **Print** | File download or print dialog |
| 9 | DevTools → `GET /api/oil-live/sync-status` | `terminal_count`, `cargo_record_count`, optional `graph_sync_steps` |

### Crisis desk (Phase 1 extension)

| Step | Pass when |
|------|-----------|
| Select lens **Crisis desk** | Map flies toward Hormuz bbox |
| Panel loads **Hormuz disruption v1** | Disclaimer + 3 watch zones (may show gaps) |
| **Top corridors in scenario** | ≥1 row after dev seed script |
| **Top plays** | Opportunity buttons open drawer |

Sign-off: tick rows in [PHASE1_EXIT_CRITERIA.md](./PHASE1_EXIT_CRITERIA.md) and `.paperclip/PHASE1_EXECUTION_SIGNOFF.md`.
