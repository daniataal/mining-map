# Execute pillar spike — RFQ-lite and compliance gates (MER-F-RFQ)

**Phase:** 3 (gated). **Do not ship marketplace execute without legal sign-off.**

## Goal

After Phase 2 scorer proves trader value, add a **minimal RFQ loop**: intelligence → structured request → deal room — without payments, custody, or title transfer.

## Proposed scope (spike only)

| Layer | Deliverable |
|-------|-------------|
| Schema | `trade_rfq_drafts` (id, opportunity_id, parties_json, route_json, tier, status=draft) |
| API | `POST /api/oil-live/rfq/draft` from deal pack; read in deal room |
| UI | “Create RFQ draft” on Deal Execution Pack → investigations |
| Compliance | Checklist UI: sanctions reviewed, tier acknowledged, no auto-block |

## Out of scope

- KYC/AML vendor integration, payments, escrow, insurance bind, licensed broker execution
- Presenting RFQ as legally binding offer

## Dependencies

- MAD-4x-g/h scorer validated in production-like traffic
- Deal pack v2 export (audit trail)

## Decision log

Record CEO/legal approval in Obsidian `12_Decisions/` before implementation issues are assigned.
