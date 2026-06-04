# Storage coverage audit runbook

Measure global petroleum storage map coverage and triage OSM gaps before adding curated hubs.

## Generate report

```bash
curl -s 'http://127.0.0.1:8000/api/storage/coverage/report?write_queue=true&write_audit=true' | jq '.totals, .gap_candidate_count'
```

Admin (writes audit + queue):

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/admin/storage/coverage-audit' -H "X-Admin-Token: $ADMIN_TOKEN"
```

## Regional Overpass refresh (gap queue)

After `storage_gap_queue.json` is populated:

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/admin/petroleum-osm/sync?from_gap_queue=true' -H "X-Admin-Token: $ADMIN_TOKEN"
```

Or explicit tiles: `?tiles=mena,europe`

## Curated gap-fill (Ashkelon pattern)

1. Confirm OSM sparse in report (`curated_gap_fill` or `port_sparse_osm`).
2. Add hub to `data/storage_terminals_seed.json` with `source_record_url`, honest `capacity_text`, and `retain_near_osm: true` when a second facility exists within 8 km.
3. Optional: add port tenants in `data/port_authority_directories.json` and `osm_partition_bbox` for multi-operator farms (FOIZ / Ras Tanura).
4. `PYTHONPATH=. python3 -m unittest backend.tests.test_storage_terminals_seed -q`

## Verify on map

`GET /api/storage/terminals?south=31.6&west=34.5&north=31.7&east=34.6&limit=500` — expect entities or `coverage_gap: true`.
