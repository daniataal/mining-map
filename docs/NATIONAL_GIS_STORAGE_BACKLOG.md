# National GIS petroleum storage — ingest backlog

Prioritized from [DATA_SOURCES.md](./DATA_SOURCES.md) gap table and [OPEN_DATA_MATRIX_MAD-45.md](./OPEN_DATA_MATRIX_MAD-45.md) §2.3 (`national_gis_storage`).

**Policy:** Verify ArcGIS/FeatureServer `returnCountOnly` and license before adding to `OPEN_DATA_SOURCES`. Do not ingest paywalled or token-gated layers without explicit tier labeling.

| Priority | Country / region | Dataset hint | Ingest method | Status |
|----------|------------------|--------------|---------------|--------|
| P1 | Kazakhstan | Committee of Geology / gis-terra.kz hydrocarbon contract areas | ArcGIS probe | Gap — research layer IDs |
| P1 | Norway | NPD Factmaps (production licences; related infra) | `arcgis` (licences in repo) | Partial — storage polygons separate |
| P1 | United States | BLM fluid minerals + EIA PADD storage (gov seed) | `arcgis` + gov seed | Partial |
| P1 | United Kingdom | COMAH major hazard sites (HSE open data) | API/CSV | Gap — extend `storage_terminals_gov_seed.json` |
| P2 | Colombia / Mexico / Peru | National mining/oil cadastre (see §2.1) | `arcgis` | Licences only today |
| P2 | Saudi Arabia / UAE | National energy ministry GIS portals | ArcGIS probe | Curated + OSM hubs until verified |
| P2 | Brazil | ANP installation registry | Portal / CSV | Gap |
| P3 | EU member states | data.europa.eu petroleum installation datasets | Per-dataset | Research |
| P3 | India | CGPB / state petroleum GIS | Portal | Gap — Jamnagar corridor on curated+OSM |

**Workflow after a layer is verified:**

1. Add row to `DATA_SOURCES.md` §2.1 or §3.
2. Wire `open_data_sync.py` source or dedicated importer → `licenses` / `petroleum_osm_features` as appropriate.
3. Run `storage_coverage_report` and remove redundant curated hubs only when OSM/official geometry is dense (≥3 tanks within 2 km).

**Paperclip:** one issue per country/layer; attach `data/coverage/storage_audit_*.json` diff after sync.
