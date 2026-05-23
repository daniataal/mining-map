# Meridian product management playbook

**Owner:** Codex Product Manager (Paperclip) + CEO (Cursor) approval.  
**Architecture source of truth:** [docs/MERIDIAN_PLATFORM_ARCHITECTURE.md](../docs/MERIDIAN_PLATFORM_ARCHITECTURE.md).

This doc fills gaps that blocked PM work: backlog structure, prioritization, templates, ceremonies, and agent handoffs.

---

## 1. What was missing (now fixed)

| Gap | Remedy |
|-----|--------|
| No PM agent | **Codex Product Manager** (`codex_local`) — `bash scripts/paperclip-codex-pm.sh` |
| Epics too vague (“make the system great”) | Vertical-slice template + Phase 1 breakdown (§4) |
| No prioritization rubric | §3 scoring — same dimensions as `AGENTS.md` |
| Weak acceptance criteria | Issue template §5 |
| No definition of done by role | §6 |
| Agent assignment unclear | §7 matrix |
| No backlog groom cadence | §8 ceremonies |

---

## 2. Product pillars (every ticket must name one)

| Pillar | User outcome |
|--------|----------------|
| **Discover** | Find counterparties, corridors, vessels, licenses on the map |
| **Verify** | Provenance, tiers, source URLs, sanctions signals |
| **Price** | Benchmarks, corridor economics, deal pack context |
| **Execute** | Suppliers, deal rooms, export, RFQ-lite (roadmap) |

---

## 3. Prioritization rubric (score 1–5 each)

| Dimension | Question |
|-----------|----------|
| **Trader value** | Does this help close, price, or verify a deal faster? |
| **Legality** | Public API / open license only? |
| **Map slice** | ingest → Postgres → bbox API → layer → drawer in same epic? |
| **Reuse** | Helps diesel, mining, and oil—not a one-off demo? |
| **Risk** | Adapter/fleet/perf regression? |

**Prefer:** highest `(trader × legality × map)` — deprioritize map-only pixels without DB rows.

---

## 4. Phase 1 backlog (recommended next epics)

Break “platform great” into these **vertical slices** (one MAD parent + 2–4 child issues each):

| Epic | Deliverable | Primary engineer |
|------|-------------|------------------|
| **P1-A Vessel drawer** | Port calls + MCR parties + tier badges in drawer | Cursor Engineer |
| **P1-B Historic arcs on map** | `eia_historic_imports` arcs + honest tier | OpenRouter + Cursor |
| **P1-C Company shipment list** | ImportYeti-shaped search → stored rows | OpenRouter Engineer |
| **P1-D Infrastructure layer** | OSM pipelines/storage bbox layer | OpenRouter Engineer |
| **P1-E sync-status banner** | Honest counts + last sync in Live Data | Cursor Engineer |

Each epic **acceptance criteria** must include: table(s) touched, API route, map layer toggle, tier labels, verify curl/UI steps.

---

## 5. Issue templates

### Feature epic (parent)

```markdown
## Problem
[Trader question in one sentence]

## Pillar
Discover | Verify | Price | Execute

## Phase
Phase 1 | 2 | 3 (see MERIDIAN_PLATFORM_ARCHITECTURE.md §7)

## Vertical slice
- [ ] Ingest / migration
- [ ] Postgres rows + indexes
- [ ] Bbox API
- [ ] Map layer + toggle
- [ ] Drawer / search hit

## Acceptance criteria
1. …
2. …

## Out of scope
…

## Assignee hint
Cursor Engineer | OpenRouter Engineer | …

Branch: paperclip2
```

### PM spike / research

```markdown
## Question
…

## Deliverable
Issue doc key `prd` OR comment with 3 options + recommendation

## Sources
[URLs — open data only]

Branch: paperclip2
```

### Fleet / ops (Architect, not PM code)

Assign **Meridian Architect** — not this PM agent.

---

## 6. Definition of done

| Role | Done when |
|------|-----------|
| **PM (Codex)** | PRD doc or child issues exist; CEO can assign engineers |
| **Engineer** | Code merged on `paperclip2`; comment with verify steps; tiers intact |
| **CTO** | ADR / architecture comment; implementation split to engineers |
| **Architect** | Fleet checklist comment; remediation issues if needed |
| **CEO** | Backlog ordered; blocked issues recovered |

---

## 7. Agent assignment matrix

| Work type | Agent |
|-----------|--------|
| Backlog, PRD, acceptance criteria, epic split | **Codex Product Manager** |
| CEO orchestration, hire, unblock | **CEO (Cursor)** |
| React map, drawers, performance | **Cursor Engineer** |
| Backend ingest, Go/Python, APIs | **OpenRouter Engineer** |
| ADR, compose, migrations review | **CTO (Ollama)** |
| Fleet health | **Meridian Architect** |
| Quick triage comment | **Groq Fast Analyst** |
| Ollama repo slices (small) | **Antigravity Engineer** |
| External research / vault | **OpenClaw Operator** |

---

## 8. Ceremonies (lightweight)

| When | Who | Output |
|------|-----|--------|
| **Backlog groom** (weekly) | CEO + PM | Top 5 `todo` issues scored; stale `in_progress` → `todo` or `blocked` |
| **Fleet check** (after adapter changes) | Architect | Comment on MAD fleet issue |
| **Phase review** (monthly) | CEO + PM + CTO | Update Phase table in architecture doc if boundaries shift |

---

## 9. Install / verify Codex PM

```bash
# Optional: add OPENAI_API_KEY to ~/ai-agent-stack/.env
# Or ensure codex login inside container: docker exec -it paperclip-safe codex login

bash scripts/paperclip-codex-pm.sh
```

Paperclip UI → **Agents** → Resume **Codex Product Manager** → assign epic → **New run**.

---

## 10. Sandbox

All agents: [.paperclip/AGENT-SANDBOX.md](./AGENT-SANDBOX.md) — work in `/workspace/repo`, web OK, no host escape.
