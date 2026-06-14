# MadSan Opportunity Originator Product Plan

## Product Interaction Model

MadSan should use three levels of intelligence depth:

1. Map popup for fast discovery.
   - Clicking an asset, vessel, route, storage site, or STS signal opens a compact truth card.
   - The popup shows name, type, confidence/source tier, operator or product hints when present, and actions.
   - It does not fetch the full dossier by default, keeping exploration fast.

2. Right rail for active investigation.
   - The rail is the working intelligence surface.
   - It should show selected chains, buyer candidates, supplier candidates, cargo clues, STS predictions, investor/control paths, contacts/source refs, and risk warnings.
   - The rail answers why the selected thing is commercially interesting right now.

3. Full dossier page for deep due diligence.
   - Full pages are shareable routes:
     - `/intel/asset/{id}`
     - `/intel/company/{id}`
     - `/intel/vessel/{mmsi}`
   - The full dossier is where subscription value accumulates: chain intelligence, buyers, suppliers, vessels, contacts, prices, evidence, and risk.

## Full Dossier Structure

Each full dossier should converge toward these sections:

- Overview: identity, role, confidence, asset/company/vessel profile.
- Commercial chain: investor -> parent -> asset -> route -> vessel/cargo -> buyer -> spread.
- Ownership: current owner/operator, parent, investor links, previous ownership checks.
- Buyers and suppliers: known, likely, and replacement opportunity counterparties.
- Vessels and voyages: AIS, port calls, cargo estimates, STS, route patterns.
- STS leads: open-to-STS vessels, predicted STS pairs, active/completed STS events, owner/operator contacts, buyer/supplier rationale.
- Contacts: direct emails/phones when available, otherwise official source refs and verification pivots.
- Prices and margin: benchmark context, freight/quality adjustments, landed margin.
- Evidence: GEM, JODI, EIA, registry, AIS, import/procurement, and source provenance.
- Risk: sanctions, stale data, weak ownership, spoofing, emissions/compliance, and confidence limitations.

## Monetization Role

- Free users get map discovery and limited popup truth.
- Pro users get right-rail chain intelligence, opportunity scores, cargo movement, buyer/supplier paths, and price context.
- Enterprise users get full dossier pages, exports, API access, watchlists, alerts, and investor/lane monitoring.

## Implementation Status

- Map click popup: implemented as quick truth card with Inspect Rail and Open Dossier actions.
- Full dossier route: implemented for asset, company, and vessel surfaces.
- Right rail chain inspector: implemented for investor paths and cargo/buyer intelligence.
- Full dossier commercial workspace: implemented with chain, buyer/importer, supplier/lane, vessel/cargo, contacts/ownership, STS, and risk/gap sections.
- Targeted dossier intel pack: implemented through `/api/intel/entities/{type}/{id}/commercial-profile`, returning linked investor paths, opportunities, cargo movements, importers, STS predictions, market pressure, benchmarks, ownership, contacts, and investor exposures without broad client-side scans.
- Remaining: deeper dossier tabs for buyer/supplier/cargo/risk workflows, open-to-STS vessel leads, commercial STS rebuild, full voyage chain geometry, tank/pipeline content inference, and landed-margin refinement.

## STS Product Surface

STS should be split into:

- `Open vessels`: single-vessel broker leads based on AIS destination keywords, loitering, OPL/STS zone behavior, draft trend, and owner/operator contacts.
- `Predicted STS`: vessel pairs likely to meet soon because route, product, draft, supplier/buyer, ownership, and market context line up.
- `Active STS`: vessels currently matching proximity, speed, duration, and restricted-maneuverability signals.
- `Completed STS`: historical events with evidence chain, draft shift, zone, and route context.
- `Risk`: spoofing, sanctions, stale AIS, unclear ownership, weak cargo evidence, and compliance exposure.

Each STS card should expose vessel identity, current zone, product hint, cargo quantity range when available, owner/operator/manager, contacts/source refs, likely supplier/buyer rationale, price or market reason, confidence, and evidence labels.
