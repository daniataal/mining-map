# Cursor Handoff: MadSan Opportunity Originator

## Role Split

Cursor is the implementation worker for focused UI/product tasks.
Codex is the reviewer, architect, and backend/intelligence integrator.

Cursor should make one focused change at a time, run checks, and then stop for Codex review.

## Hard Scope

- Work inside `madsan/`.
- Do not work in `mining-viz/`.
- Read the repository instructions before editing.
- Use the repository root for graphify:
  - `/Users/daniatallah/Gold Project /mining-map`
- Before broad code work, run:
  - `graphify query "MadSan opportunity originator dossier tabs linked_intel"`
- After code changes, run:
  - `graphify update .`
- Do not create new permanent Python production systems.
- Do not add duplicate vessel tables, AIS workers, provider paths, or paid/proprietary data assumptions.
- Do not drop data, reset volumes, delete tables, or expose secrets.
- Separate observed, reported, inferred, estimated, and predicted intelligence labels.

## Current Product State

MadSan is becoming an open-source-backed oil/gas/LNG opportunity originator:

`real supplier + real buyer + real asset + real owner + real route + real vessel/cargo clue + market/price context + risk/confidence`

Already implemented:

- Map click popup with quick truth card and `Open dossier`.
- Full dossier routes:
  - `/intel/asset/{id}`
  - `/intel/company/{id}`
  - `/intel/vessel/{mmsi}`
- Targeted commercial profile API:
  - `/api/intel/entities/{type}/{id}/commercial-profile`
- Dossier commercial workspace using `linked_intel`.
- Vessel dossier can show cargo, owner/operator, contacts, ownership checks, and registry/manual verification pivots.
- Opportunity panel can show lanes, cargo, STS, and selected chain context.
- STS is broader than one prediction list: final UX should eventually separate open-to-STS vessels, predicted STS pairs, active STS, completed STS, and risk.

Known local services:

- Frontend: `http://127.0.0.1:3011`
- API: `http://127.0.0.1:8097`

## Main Cursor Task

Improve the full dossier UX using the existing `linked_intel` payload.

The goal is not a prettier page. The goal is a commercial analyst workspace that clearly answers:

- Who is connected to this asset/company/vessel?
- Who owns or operates it?
- Who might be buying or selling?
- What cargo/vessel movement supports the idea?
- What market or price context makes it interesting?
- What should the user verify before outreach?

## Files To Focus On

Primary:

- `madsan/frontend/src/components/DossierPageClient.tsx`
- `madsan/frontend/src/lib/energyApi.ts`
- `madsan/frontend/src/app/globals.css`
- `madsan/agent_reports/opportunity_originator_product_plan.md`

Read-only context unless truly necessary:

- `madsan/frontend/src/components/EntityDossierPanel.tsx`
- `madsan/frontend/src/components/OpportunityOriginatorPanel.tsx`
- `madsan/backend/internal/api/oil_opportunity_engine.go`

Avoid backend changes unless the frontend exposes a clear missing field that already exists in the DB and Codex/user approve it.

## Desired UX Change

Turn the dossier commercial workspace into real tabs or segmented sections:

- `Chain`
- `Cargo`
- `Buyers`
- `Suppliers`
- `Ownership`
- `Contacts`
- `Market`
- `Risk`

Do not make a marketing page. This is an analyst tool.

Use compact, dense, readable cards with evidence labels and action cues. Avoid oversized hero blocks, decorative sections, and vague text.

## Required Behavior

For a vessel dossier, show:

- Cargo movement cards from `linked_intel.cargo_movements`.
- Owner/operator from top-level vessel profile and cargo `commercial_chain`.
- Contacts from `commercial_contacts` and contact bundles inside cargo chain.
- Previous name/history and previous ownership candidates from `ownership_intel`.
- Registry/manual check pivots from `ownership_intel.registry_checks`.
- STS predictions from `linked_intel.sts_predictions`.
- If STS data is empty, use gap states that distinguish:
  - no open-vessel lead yet
  - no predicted pair yet
  - no active/completed STS event yet
- Risk notes explaining stale AIS, inferred cargo, weak ownership, or missing STS.

For an asset dossier, show:

- Ownership chain from `ownership_chain` and `linked_intel.ownership_chain`.
- Investor exposures from `investor_exposures` and `linked_intel.investor_exposures`.
- Investor paths from `linked_intel.investor_paths`.
- Opportunities from `linked_intel.opportunities`.
- Cargo/vessels from `linked_intel.cargo_movements`.
- Market pressure and benchmarks from `linked_intel.market_pressure` and `linked_intel.benchmarks`.
- Clear gap states when no chain is attached yet.

For a company dossier, show:

- Operated/owned assets from `assets` and `linked_intel.assets`.
- Contacts from `contacts`.
- Buyer/importer evidence from `trade_flow_summary` and `linked_intel.importers`.
- Investor exposures and paths.
- Cargo/vessel involvement if the company owns or operates vessels.

## UX Rules

- Every card should show an evidence label:
  - `observed`
  - `reported`
  - `source-backed`
  - `inferred`
  - `estimated`
  - `predicted`
- Every inferred or estimated value should look visibly different from source-backed identity.
- Empty states should be useful:
  - Say what is missing.
  - Say what data would unlock the section.
  - Do not imply the real-world thing does not exist.
- Add compact action buttons where natural:
  - `Show chain`
  - `Compare margin`
  - `Open source`
  - `Verify owner`
  - `Watch route`
- Do not add actions that are fake or not wired unless they are visibly disabled/pending.
- Do not use large explanatory instructional text inside the app.
- Keep text fitting inside cards at desktop and mobile widths.

## Acceptance Criteria

Cursor should verify all of these before handing back:

- `npm run typecheck` passes from `madsan/frontend`.
- `git diff --check` passes from repo root.
- Browser verification on:
  - `http://127.0.0.1:3011/intel/vessel/412379000?name=BEI%20HAI%20FENG%20HUANG`
  - The page shows cargo for `BEI HAI FENG HUANG`.
  - The page shows owner/contact/ownership checks for `S NORTH SEA`.
  - The page has the new tab/section layout.
- Browser verification on:
  - `http://127.0.0.1:3011/intel/asset/748fc49f-2742-4f38-9c10-17aa0b5f1913?name=Fujairah+Oil+Industry+Zone+%28FOIZ%29`
  - The page truthfully shows gap states and benchmark context.
- No raw GEM/JODI files are added to git.
- No unrelated files are reformatted.

## Handoff Response Required From Cursor

When done, Cursor should report:

- Changed files.
- What changed in product terms.
- Verification commands and results.
- Browser URLs checked.
- Remaining limitations.
- Any data/API gaps that blocked better UX.

## Codex Review Gate

After Cursor finishes, Codex should review as a code reviewer:

- Check for regressions, broken typing, excessive client-side scanning, bad evidence labeling, and UI overflow.
- Re-run relevant commands.
- Inspect browser screenshots/DOM for the vessel and FOIZ dossier.
- Confirm no `mining-viz/` changes.
- Confirm docs plan still matches implementation.
- Decide whether to request fixes or continue to the next backend/intelligence step.

## Next Backend Step After Cursor UX

Once dossier tabs are solid, Codex should continue with the cargo/voyage chain layer:

- Vessel -> latest AIS destination.
- Vessel -> cargo estimate.
- Vessel -> owner/operator/contact.
- Destination -> likely buyer assets/importers.
- Product -> market pressure and benchmark context.
- Chain overlay geometry where route/asset/vessel geometry exists.
- Build open-to-STS vessel leads from AIS destination keywords, loitering, OPL/STS zones, navigation status, draft, and owner/contact evidence.
- Then rebuild commercial STS using supplier/buyer/cargo/route/open-vessel logic, not just proximity.
