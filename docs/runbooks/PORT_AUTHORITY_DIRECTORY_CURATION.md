# Port authority directory curation runbook

Add or update **major customer / tenant lists** from public port authority web pages (e.g. [Port of Fujairah — Major Customers](https://fujairahport.ae/port-overview/major-customers/)).

## When to use

- Traders need **who operates at a port** (tank farms, bunker suppliers, agents) beyond UN/LOCODE geometry.
- You have a stable public URL listing tenants (marketing page, not a paid registry).

## Steps

1. **Resolve UN/LOCODE** for the port (e.g. Fujairah = `AEFJR`). Confirm the port appears in `/api/logistics/ports` or UN/LOCODE CSV.
2. **Edit** [`data/port_authority_directories.json`](../../data/port_authority_directories.json):
   - Add or update a `ports[]` object with `locode`, `port_name`, `port_authority_name`, `source_url`, `country`, `lat`/`lng`.
   - Add `tenants[]` entries: `{ "name", "category", "role_note?", "curated_storage_external_id?" }`.
3. **Categories** (use exact ids):
   - `tank_storage_and_refineries`
   - `bunker_suppliers`
   - `shipping_agents`
   - `aggregate_exporters`
   - `other`
4. **Optional storage hub link:** If the tenant is a named tank farm on the map, add a row to [`data/storage_terminals_seed.json`](../../data/storage_terminals_seed.json) and set `curated_storage_external_id` to the seed id (`curated_storage_{slug(name)}_{slug(country)}` — see `storage_terminals_seed._external_id`).
5. **Update** `meta.source_accessed_at` in the JSON when you refresh from the source page.
6. **Verify:**
   - `PYTHONPATH=. python3 -m unittest backend.tests.test_port_authority_directory -q`
   - `curl http://127.0.0.1:8080/api/ports/{LOCODE}/directory`
   - Ports view → open port dossier → **Major customers (port authority)**
7. **Graph-sync** (indexes tenants into `oil_companies`): `POST /api/admin/oil-live/graph-sync` — check step `port_authority_tenants`.

## Do not

- Invent tank capacities or operators not on the source page.
- Scrape paywalled or robots-disallowed sites without review.
- Present the list as official regulator confirmation — UI disclaimer is required.

## Rollback

Revert the JSON commit; restart backend. No DB migration required for directory data (company rows from graph-sync are upserts only).
