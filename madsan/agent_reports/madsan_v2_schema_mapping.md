# Schema Mapping — Legacy → MadSan Canonical

| Legacy table | Target | Strategy |
|--------------|--------|----------|
| licenses | assets (mine) + evidence | ETL staging → normalize lat/lng → geom |
| oil_companies | companies | Splink dedup + core_organizations merge |
| oil_terminals + storage_terminal_display | assets (tank_farm/terminal) | Reconcile oil_terminals=0 |
| petroleum_osm_features | assets (pipeline) + raw | Preserve tags in raw_payload |
| oil_vessels | vessels | IMO/MMSI key |
| oil_port_calls | evidence + voyages | Port call claims |
| meridian_cargo_records | deals/signals + evidence | MCR v2 port |
| oil_sts_events | core_signals (sts) | 6-factor score upgrade |
| core_* (024) | extend in place | Add commodities, prices, deals, etc. |
| entity_contacts | contacts | Source-backed |
| bunker_fuel_suppliers_seed.json | companies + suppliers | sources registry row |

Dual-schema during cutover: legacy tables read-only; madsan writes canonical only.
